from datetime import date, datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

ROLES = ("admin", "manager", "designer")
CONTENT_TYPES = ("Static", "Reel", "Carousel")
POSTING_TYPES = ("Story", "Feed")

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
