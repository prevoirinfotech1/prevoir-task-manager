import os
from datetime import date
from functools import wraps

from flask import Flask, jsonify, request, send_file, send_from_directory
from flask_login import (
    LoginManager, login_user, logout_user, login_required, current_user,
)

from extensions import db, login_manager
from models import User, Client, Task
from excel_utils import read_rows_from_upload, import_tasks, build_template_workbook


def create_app():
    app = Flask(__name__, static_folder="static", template_folder="templates")

    database_url = os.environ.get("DATABASE_URL", "sqlite:///prevoir.db")
    # Render/Heroku hand out "postgres://" — SQLAlchemy 1.4+ wants "postgresql://"
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)

    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024  # 8 MB upload cap

    db.init_app(app)
    login_manager.init_app(app)

    with app.app_context():
        db.create_all()
        seed_default_admin()
        migrate_legacy_single_assignments()

    register_routes(app)
    return app


def seed_default_admin():
    if User.query.count() == 0:
        admin = User(name="Administrator", username="admin", role="admin", active=True)
        admin.set_password("admin123")
        db.session.add(admin)
        db.session.commit()


def migrate_legacy_single_assignments():
    """
    One-time, safe backfill: earlier versions stored a single manager/designer
    per client in manager_id/designer_id columns. Those columns still exist
    (untouched) on any database created by an earlier deploy. This copies
    any values found there into the new many-to-many tables, then leaves the
    old columns alone. Running this repeatedly is harmless — it only adds a
    link if it's not already there.
    """
    try:
        clients = Client.query.all()
    except Exception:
        return  # table doesn't exist yet on a brand-new database — nothing to migrate

    changed = False
    for c in clients:
        if c.legacy_manager_id:
            already = any(u.id == c.legacy_manager_id for u in c.managers)
            if not already:
                u = db.session.get(User, c.legacy_manager_id)
                if u and u.role == "manager":
                    c.managers.append(u)
                    changed = True
        if c.legacy_designer_id:
            already = any(u.id == c.legacy_designer_id for u in c.designers)
            if not already:
                u = db.session.get(User, c.legacy_designer_id)
                if u and u.role == "designer":
                    c.designers.append(u)
                    changed = True
    if changed:
        db.session.commit()


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


@login_manager.unauthorized_handler
def unauthorized():
    return jsonify({"error": "Not signed in"}), 401


def roles_required(*roles):
    def decorator(fn):
        @wraps(fn)
        @login_required
        def wrapper(*args, **kwargs):
            if current_user.role not in roles:
                return jsonify({"error": "You don't have access to do that."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def to_int_or_none(value):
    try:
        return int(value) if value not in (None, "", False) else None
    except (TypeError, ValueError):
        return None


def to_int_list(values):
    out = []
    if not values:
        return out
    for v in values:
        n = to_int_or_none(v)
        if n is not None:
            out.append(n)
    return out


def client_visible_to_current_user(client):
    if current_user.role == "admin":
        return True
    if current_user.role == "manager":
        return any(u.id == current_user.id for u in client.managers)
    if current_user.role == "designer":
        return any(u.id == current_user.id for u in client.designers)
    return False


def client_editable_by_current_user(client):
    """Managers/admin can edit task content. Designers cannot."""
    if current_user.role == "admin":
        return True
    if current_user.role == "manager":
        return any(u.id == current_user.id for u in client.managers)
    return False


def register_routes(app):

    # ---------- Frontend ----------
    @app.route("/")
    def index():
        return send_from_directory(app.template_folder, "index.html")

    # ---------- Auth ----------
    @app.route("/api/login", methods=["POST"])
    def api_login():
        data = request.get_json(silent=True) or {}
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        user = User.query.filter(User.username.ilike(username)).first()
        if not user or not user.check_password(password):
            return jsonify({"error": "Incorrect username or password."}), 401
        if not user.active:
            return jsonify({"error": "This login has been deactivated. Contact your admin."}), 403
        login_user(user, remember=True)
        return jsonify({"user": user.to_dict()})

    @app.route("/api/logout", methods=["POST"])
    @login_required
    def api_logout():
        logout_user()
        return jsonify({"ok": True})

    @app.route("/api/me")
    def api_me():
        if not current_user.is_authenticated:
            return jsonify({"user": None})
        return jsonify({"user": current_user.to_dict()})

    @app.route("/api/me/change-password", methods=["POST"])
    @login_required
    def change_my_password():
        data = request.get_json(silent=True) or {}
        current_pw = data.get("currentPassword") or ""
        new_pw = data.get("newPassword") or ""
        if not current_user.check_password(current_pw):
            return jsonify({"error": "Current password is incorrect."}), 400
        if len(new_pw) < 4:
            return jsonify({"error": "New password must be at least 4 characters."}), 400
        current_user.set_password(new_pw)
        db.session.commit()
        return jsonify({"ok": True})

    # ---------- Bootstrap state ----------
    @app.route("/api/state")
    @login_required
    def api_state():
        users = [u.to_dict() for u in User.query.order_by(User.name).all()]

        if current_user.role == "admin":
            clients_q = Client.query
        elif current_user.role == "manager":
            clients_q = Client.query.filter(Client.managers.any(User.id == current_user.id))
        else:
            clients_q = Client.query.filter(Client.designers.any(User.id == current_user.id))
        clients = [c.to_dict() for c in clients_q.order_by(Client.created_at.desc()).all()]

        client_ids = [c["id"] for c in clients]
        tasks = []
        if client_ids:
            tasks = [
                t.to_dict()
                for t in Task.query.filter(Task.client_id.in_(client_ids)).all()
            ]

        return jsonify({"me": current_user.to_dict(), "users": users, "clients": clients, "tasks": tasks})

    # ---------- User management (admin only) ----------
    @app.route("/api/users", methods=["POST"])
    @roles_required("admin")
    def create_user():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        username = (data.get("username") or "").strip()
        password = data.get("password") or ""
        role = data.get("role")

        if role not in ("manager", "designer"):
            return jsonify({"error": "Role must be manager or designer."}), 400
        if not name or not username or not password:
            return jsonify({"error": "Name, username and password are required."}), 400
        if User.query.filter(User.username.ilike(username)).first():
            return jsonify({"error": "That username is already taken."}), 400

        user = User(name=name, username=username, role=role, active=True)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return jsonify({"user": user.to_dict()}), 201

    @app.route("/api/users/<int:user_id>/reset-password", methods=["POST"])
    @roles_required("admin")
    def reset_password(user_id):
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found."}), 404
        data = request.get_json(silent=True) or {}
        password = data.get("password") or ""
        if len(password) < 4:
            return jsonify({"error": "Password is too short."}), 400
        user.set_password(password)
        db.session.commit()
        return jsonify({"ok": True})

    @app.route("/api/users/<int:user_id>/toggle-active", methods=["POST"])
    @roles_required("admin")
    def toggle_active(user_id):
        user = db.session.get(User, user_id)
        if not user:
            return jsonify({"error": "User not found."}), 404
        if user.role == "admin":
            return jsonify({"error": "Admin logins can't be deactivated here."}), 400
        user.active = not user.active
        db.session.commit()
        return jsonify({"user": user.to_dict()})

    # ---------- Clients ----------
    @app.route("/api/clients", methods=["POST"])
    @roles_required("admin")
    def create_client():
        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Client name is required."}), 400
        client = Client(name=name)
        manager_ids = to_int_list(data.get("managerIds"))
        designer_ids = to_int_list(data.get("designerIds"))
        if manager_ids:
            client.managers = User.query.filter(User.id.in_(manager_ids), User.role == "manager").all()
        if designer_ids:
            client.designers = User.query.filter(User.id.in_(designer_ids), User.role == "designer").all()
        db.session.add(client)
        db.session.commit()
        return jsonify({"client": client.to_dict()}), 201

    @app.route("/api/clients/<int:client_id>", methods=["PATCH"])
    @roles_required("admin")
    def update_client(client_id):
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({"error": "Client not found."}), 404
        data = request.get_json(silent=True) or {}
        if "managerIds" in data:
            ids = to_int_list(data["managerIds"])
            client.managers = User.query.filter(User.id.in_(ids), User.role == "manager").all() if ids else []
        if "designerIds" in data:
            ids = to_int_list(data["designerIds"])
            client.designers = User.query.filter(User.id.in_(ids), User.role == "designer").all() if ids else []
        if "name" in data and data["name"].strip():
            client.name = data["name"].strip()
        db.session.commit()
        return jsonify({"client": client.to_dict()})

    @app.route("/api/clients/<int:client_id>", methods=["DELETE"])
    @roles_required("admin")
    def delete_client(client_id):
        client = db.session.get(Client, client_id)
        if not client:
            return jsonify({"error": "Client not found."}), 404
        db.session.delete(client)
        db.session.commit()
        return jsonify({"ok": True})

    # ---------- Tasks ----------
    @app.route("/api/clients/<int:client_id>/tasks", methods=["POST"])
    @login_required
    def create_task(client_id):
        client = db.session.get(Client, client_id)
        if not client or not client_editable_by_current_user(client):
            return jsonify({"error": "You don't have access to this client."}), 403
        data = request.get_json(silent=True) or {}
        if not data.get("date") or not data.get("deadline"):
            return jsonify({"error": "Date and deadline are required."}), 400
        task = Task(
            client_id=client.id,
            date=data.get("date"),
            deadline=data.get("deadline"),
            content_type=data.get("contentType") or "Static",
            posting_type=data.get("postingType") or "Feed",
            objective=data.get("objective") or "",
            details=data.get("details") or "",
            caption=data.get("caption") or "",
            reference=data.get("reference") or "",
            remark=data.get("remark") or "",
            status="Pending",
        )
        db.session.add(task)
        db.session.commit()
        return jsonify({"task": task.to_dict()}), 201

    @app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
    @login_required
    def update_task(task_id):
        task = db.session.get(Task, task_id)
        if not task:
            return jsonify({"error": "Task not found."}), 404
        client = db.session.get(Client, task.client_id)
        data = request.get_json(silent=True) or {}

        if current_user.role == "designer":
            if not client or not client_visible_to_current_user(client):
                return jsonify({"error": "You don't have access to this task."}), 403
            # designers may only mark a task complete
            if set(data.keys()) - {"status"}:
                return jsonify({"error": "Designers can only update task status."}), 403
            if data.get("status") != "Completed":
                return jsonify({"error": "Invalid status update."}), 400
            task.status = "Completed"
            task.completed_at = date.today().isoformat()
            db.session.commit()
            return jsonify({"task": task.to_dict()})

        if not client or not client_editable_by_current_user(client):
            return jsonify({"error": "You don't have access to this task."}), 403

        editable_fields = [
            "date", "deadline", "contentType", "postingType", "objective",
            "details", "caption", "reference", "remark", "status",
        ]
        field_map = {
            "contentType": "content_type", "postingType": "posting_type",
        }
        for f in editable_fields:
            if f in data:
                attr = field_map.get(f, f)
                setattr(task, attr, data[f])
        if data.get("status") == "Completed" and not task.completed_at:
            task.completed_at = date.today().isoformat()
        elif data.get("status") == "Pending":
            task.completed_at = None
        db.session.commit()
        return jsonify({"task": task.to_dict()})

    @app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
    @login_required
    def delete_task(task_id):
        task = db.session.get(Task, task_id)
        if not task:
            return jsonify({"error": "Task not found."}), 404
        client = db.session.get(Client, task.client_id)
        if not client or not client_editable_by_current_user(client):
            return jsonify({"error": "You don't have access to this task."}), 403
        db.session.delete(task)
        db.session.commit()
        return jsonify({"ok": True})

    # ---------- Excel import / template ----------
    @app.route("/api/template.xlsx")
    @login_required
    def download_template():
        buf = build_template_workbook()
        return send_file(
            buf,
            as_attachment=True,
            download_name="Prevoir_Task_Template.xlsx",
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )

    @app.route("/api/clients/<int:client_id>/import", methods=["POST"])
    @login_required
    def import_client_tasks(client_id):
        client = db.session.get(Client, client_id)
        if not client or not client_editable_by_current_user(client):
            return jsonify({"error": "You don't have access to this client."}), 403

        if "file" not in request.files:
            return jsonify({"error": "No file received."}), 400
        file_storage = request.files["file"]
        if not file_storage.filename:
            return jsonify({"error": "No file received."}), 400

        try:
            rows = read_rows_from_upload(file_storage)
        except Exception:
            return jsonify({"error": "Could not read that file — make sure it's a valid .xlsx or .csv file."}), 400

        tasks_data, skipped, skipped_rows, error, detected_headers = import_tasks(rows)
        if error:
            return jsonify({"added": 0, "skipped": 0, "error": error, "detectedHeaders": detected_headers})

        for t in tasks_data:
            db.session.add(Task(client_id=client.id, status="Pending", **{
                "date": t["date"], "deadline": t["deadline"],
                "content_type": t["contentType"], "posting_type": t["postingType"],
                "objective": t["objective"], "details": t["details"],
                "caption": t["caption"], "reference": t["reference"], "remark": t["remark"],
            }))
        db.session.commit()

        return jsonify({"added": len(tasks_data), "skipped": skipped, "skippedRows": skipped_rows, "error": None})


app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
