from datetime import date, datetime
from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

ROLES = ("admin", "manager", "designer")
CONTENT_TYPES = ("Static", "Reel", "Carousel")
POSTING_TYPES = ("Story", "Feed")


class User(db.Model, UserMixin):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False)  # admin / manager / designer
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())

    managed_clients = db.relationship(
        "Client", foreign_keys="Client.manager_id", backref="manager", lazy="dynamic"
    )
    designed_clients = db.relationship(
        "Client", foreign_keys="Client.designer_id", backref="designer", lazy="dynamic"
    )

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
    manager_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    designer_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    created_at = db.Column(db.String(10), default=lambda: date.today().isoformat())

    tasks = db.relationship(
        "Task", backref="client", cascade="all, delete-orphan", lazy="dynamic"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "managerId": self.manager_id,
            "designerId": self.designer_id,
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
