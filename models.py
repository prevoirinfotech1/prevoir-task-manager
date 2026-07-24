from datetime import date, datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

ROLES = ("admin", "manager", "designer")
CONTENT_TYPES = ("Static", "Reel", "Carousel")
POSTING_TYPES = ("Story", "Feed")
PRIORITIES = ("High", "Medium", "Low")

# Many-to-many: a client can have several managers and several designers.
client_managers = db.Table(
    "client_managers",
    db.Column("client_id", db.Integer, db.ForeignKey("clients.id"), primary_key=True),
    db.Column("user_id", db.Integer, db.ForeignKey("users.id"), primary_key=True),
)
client_designers = db.Table(
    "client_designers",
    db.Column("client_id", db.Integer, db.ForeignKey("clients.id"), primary_key=True),
    db.Column("user_id", db.Integer, db.ForeignKey("users.id"), primary_key=True),
)


class User(db.Model, UserMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # admin / manager / designer
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())

    def set_password(self, raw_password):
        self.password_hash = generate_password_hash(raw_password)

    def check_password(self, raw_password):
        return check_password_hash(self.password_hash, raw_password)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "username": self.username,
            "role": self.role,
            "active": self.active,
            "createdAt": self.created_at,
        }


class Client(db.Model):
    __tablename__ = "clients"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())

    # Deprecated single-assignment columns, kept only so existing rows in a
    # live database can be migrated into the new many-to-many tables below.
    # Nothing new reads or writes these two columns.
    legacy_manager_id = db.Column("manager_id", db.Integer, nullable=True)
    legacy_designer_id = db.Column("designer_id", db.Integer, nullable=True)

    managers = db.relationship(
        "User", secondary=client_managers,
        backref=db.backref("managed_clients", lazy="select"),
    )
    designers = db.relationship(
        "User", secondary=client_designers,
        backref=db.backref("designed_clients", lazy="select"),
    )

    tasks = db.relationship(
        "Task", backref="client", cascade="all, delete-orphan", lazy="dynamic"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "managerIds": [u.id for u in self.managers],
            "designerIds": [u.id for u in self.designers],
            "createdAt": self.created_at,
        }


class Task(db.Model):
    __tablename__ = "tasks"

    id = db.Column(db.Integer, primary_key=True)
    client_id = db.Column(db.Integer, db.ForeignKey("clients.id"), nullable=False, index=True)

    date = db.Column(db.String(10), nullable=False)       # ISO yyyy-mm-dd
    deadline = db.Column(db.String(10), nullable=False)   # ISO yyyy-mm-dd
    content_type = db.Column(db.String(20), default=CONTENT_TYPES[0])
    posting_type = db.Column(db.String(20), default=POSTING_TYPES[0])
    objective = db.Column(db.Text, default="")
    details = db.Column(db.Text, default="")
    caption = db.Column(db.Text, default="")
    reference = db.Column(db.Text, default="")
    remark = db.Column(db.Text, default="")
    status = db.Column(db.String(20), default="Pending", nullable=False)  # Pending / Completed

    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())
    completed_at = db.Column(db.String(10), nullable=True)

    def to_dict(self):
        return {
            "id": self.id,
            "clientId": self.client_id,
            "date": self.date,
            "deadline": self.deadline,
            "contentType": self.content_type,
            "postingType": self.posting_type,
            "objective": self.objective,
            "details": self.details,
            "caption": self.caption,
            "reference": self.reference,
            "remark": self.remark,
            "status": self.status,
            "createdAt": self.created_at,
            "completedAt": self.completed_at,
        }


class OtherTask(db.Model):
    """
    A standalone, ad-hoc task not tied to any client's content calendar.
    Admin can hand these to a Manager or a Designer; a Manager can hand
    them to a Designer. The optional attachment is stored directly in the
    database (not on disk) so it survives redeploys on hosts with an
    ephemeral filesystem, e.g. Render's free tier.
    """
    __tablename__ = "other_tasks"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default="")
    priority = db.Column(db.String(10), default="Medium", nullable=False)  # High / Medium / Low
    deadline = db.Column(db.String(10), nullable=False)  # ISO yyyy-mm-dd
    status = db.Column(db.String(20), default="Pending", nullable=False)  # Pending / Completed

    assigned_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    assigned_to_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())
    completed_at = db.Column(db.String(10), nullable=True)

    attachment_name = db.Column(db.String(255), nullable=True)
    attachment_mimetype = db.Column(db.String(120), nullable=True)
    attachment_data = db.Column(db.LargeBinary, nullable=True)

    assigned_by_user = db.relationship("User", foreign_keys=[assigned_by_id])
    assigned_to_user = db.relationship("User", foreign_keys=[assigned_to_id])

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "deadline": self.deadline,
            "status": self.status,
            "assignedById": self.assigned_by_id,
            "assignedToId": self.assigned_to_id,
            "createdAt": self.created_at,
            "completedAt": self.completed_at,
            "hasAttachment": bool(self.attachment_data),
            "attachmentName": self.attachment_name,
        }
