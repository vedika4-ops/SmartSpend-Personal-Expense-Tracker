import os
import secrets
from datetime import datetime, date
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

# Initialize Flask application
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "smartspend-dev-secret-key-2026")
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{os.path.join(BASE_DIR, 'smartspend.db')}"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

# Enable CORS for cross-origin frontend requests
CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Initialize Database
db = SQLAlchemy(app)
serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])

# ==========================================
# DATABASE MODELS
# ==========================================

class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    expenses = db.relationship("Expense", backref="user", lazy=True, cascade="all, delete-orphan")
    budgets = db.relationship("Budget", backref="user", lazy=True, cascade="all, delete-orphan")
    incomes = db.relationship("Income", backref="user", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "email": self.email,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class Expense(db.Model):
    __tablename__ = "expenses"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    amount = db.Column(db.Float, nullable=False)
    category = db.Column(db.String(50), nullable=False)
    expense_date = db.Column(db.String(10), nullable=False)  # Stored as YYYY-MM-DD
    description = db.Column(db.String(255), default="No description")
    payment_method = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "amount": self.amount,
            "category": self.category,
            "date": self.expense_date,
            "description": self.description or "No description",
            "paymentMethod": self.payment_method,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class Income(db.Model):
    __tablename__ = "incomes"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    amount = db.Column(db.Float, nullable=False)
    source = db.Column(db.String(100), default="Salary")
    income_date = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "amount": self.amount,
            "source": self.source,
            "date": self.income_date,
            "created_at": self.created_at.isoformat() if self.created_at else None
        }


class Budget(db.Model):
    __tablename__ = "budgets"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    month_year = db.Column(db.String(7), nullable=False)  # YYYY-MM
    monthly_limit = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "month_year": self.month_year,
            "monthly_limit": self.monthly_limit
        }


# ==========================================
# AUTHENTICATION HELPER
# ==========================================

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return jsonify({"success": False, "message": "Missing authorization token."}), 401

        token = None
        parts = auth_header.split()
        if len(parts) == 2 and parts[0].lower() == "bearer":
            token = parts[1]
        elif len(parts) == 1:
            token = parts[0]

        if not token:
            return jsonify({"success": False, "message": "Invalid token format."}), 401

        try:
            # Token valid for 30 days
            data = serializer.loads(token, max_age=86400 * 30)
            current_user = db.session.get(User, data.get("user_id"))
            if not current_user:
                return jsonify({"success": False, "message": "User not found."}), 401
        except SignatureExpired:
            return jsonify({"success": False, "message": "Session expired. Please log in again."}), 401
        except BadSignature:
            return jsonify({"success": False, "message": "Invalid token. Please log in again."}), 401
        except Exception:
            return jsonify({"success": False, "message": "Authentication failed."}), 401

        return f(current_user, *args, **kwargs)
    return decorated


# ==========================================
# AUTH ROUTES
# ==========================================

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not name or not email or not password:
        return jsonify({"success": False, "message": "All fields are required."}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"success": False, "message": "An account with this email already exists."}), 409

    hashed_pw = generate_password_hash(password)
    new_user = User(name=name, email=email, password_hash=hashed_pw)
    db.session.add(new_user)
    db.session.commit()

    token = serializer.dumps({"user_id": new_user.id})
    return jsonify({
        "success": True,
        "message": "Account created successfully!",
        "token": token,
        "user": new_user.to_dict()
    }), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required."}), 400

    user = User.query.filter_by(email=email).first()
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"success": False, "message": "Invalid email or password."}), 401

    token = serializer.dumps({"user_id": user.id})
    return jsonify({
        "success": True,
        "message": "Login successful!",
        "token": token,
        "user": user.to_dict()
    })


@app.route("/api/me", methods=["GET"])
@token_required
def get_current_user(current_user):
    return jsonify({
        "success": True,
        "user": current_user.to_dict()
    })


# ==========================================
# EXPENSE MANAGEMENT ROUTES
# ==========================================

@app.route("/api/expenses", methods=["GET"])
@token_required
def list_expenses(current_user):
    # Optional filtering by month: ?month=2026-10
    month = request.args.get("month")
    query = Expense.query.filter_by(user_id=current_user.id)
    if month:
        query = query.filter(Expense.expense_date.startswith(month))

    expenses = query.order_by(Expense.expense_date.desc(), Expense.id.desc()).all()
    return jsonify({
        "success": True,
        "expenses": [e.to_dict() for e in expenses]
    })


@app.route("/api/expenses", methods=["POST"])
@token_required
def create_expense(current_user):
    data = request.get_json() or {}
    try:
        amount = float(data.get("amount", 0))
    except (ValueError, TypeError):
        return jsonify({"success": False, "message": "Invalid amount."}), 400

    category = (data.get("category") or "").strip()
    expense_date = (data.get("date") or "").strip()
    payment_method = (data.get("paymentMethod") or "").strip()
    description = (data.get("description") or "").strip() or "No description"

    if amount <= 0:
        return jsonify({"success": False, "message": "Amount must be greater than zero."}), 400
    if not category:
        return jsonify({"success": False, "message": "Category is required."}), 400
    if not expense_date:
        expense_date = date.today().isoformat()
    if not payment_method:
        return jsonify({"success": False, "message": "Payment method is required."}), 400

    new_expense = Expense(
        user_id=current_user.id,
        amount=amount,
        category=category,
        expense_date=expense_date,
        payment_method=payment_method,
        description=description
    )
    db.session.add(new_expense)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Expense added successfully!",
        "expense": new_expense.to_dict()
    }), 201


@app.route("/api/expenses/<int:expense_id>", methods=["PUT"])
@token_required
def update_expense(current_user, expense_id):
    expense = Expense.query.filter_by(id=expense_id, user_id=current_user.id).first()
    if not expense:
        return jsonify({"success": False, "message": "Expense not found."}), 404

    data = request.get_json() or {}
    if "amount" in data:
        try:
            amt = float(data["amount"])
            if amt <= 0:
                return jsonify({"success": False, "message": "Amount must be greater than 0."}), 400
            expense.amount = amt
        except (ValueError, TypeError):
            return jsonify({"success": False, "message": "Invalid amount."}), 400

    if "category" in data and data["category"]:
        expense.category = data["category"]
    if "date" in data and data["date"]:
        expense.expense_date = data["date"]
    if "paymentMethod" in data and data["paymentMethod"]:
        expense.payment_method = data["paymentMethod"]
    if "description" in data:
        expense.description = data["description"] or "No description"

    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Expense updated successfully!",
        "expense": expense.to_dict()
    })


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
@token_required
def delete_expense(current_user, expense_id):
    expense = Expense.query.filter_by(id=expense_id, user_id=current_user.id).first()
    if not expense:
        return jsonify({"success": False, "message": "Expense not found."}), 404

    db.session.delete(expense)
    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Expense deleted successfully!"
    })


# ==========================================
# BUDGET MANAGEMENT ROUTES
# ==========================================

@app.route("/api/budget", methods=["GET"])
@token_required
def get_budget(current_user):
    month_year = request.args.get("month") or datetime.now().strftime("%Y-%m")
    budget_entry = Budget.query.filter_by(user_id=current_user.id, month_year=month_year).first()
    limit = budget_entry.monthly_limit if budget_entry else 10000.0
    # Calculate total spent in this month
    monthly_expenses = Expense.query.filter(
        Expense.user_id == current_user.id,
        Expense.expense_date.startswith(month_year)
    ).all()
    spent = sum(e.amount for e in monthly_expenses)

    return jsonify({
        "success": True,
        "month": month_year,
        "budget": limit,
        "spent": spent,
        "remaining": limit - spent
    })


@app.route("/api/budget", methods=["POST"])
@token_required
def set_budget(current_user):
    data = request.get_json() or {}
    try:
        amount = float(data.get("amount", 0))
    except (ValueError, TypeError):
        return jsonify({"success": False, "message": "Invalid budget amount."}), 400

    if amount <= 0:
        return jsonify({"success": False, "message": "Budget must be greater than zero."}), 400

    month_year = data.get("month") or datetime.now().strftime("%Y-%m")
    budget_entry = Budget.query.filter_by(user_id=current_user.id, month_year=month_year).first()

    if budget_entry:
        budget_entry.monthly_limit = amount
    else:
        budget_entry = Budget(user_id=current_user.id, month_year=month_year, monthly_limit=amount)
        db.session.add(budget_entry)

    db.session.commit()
    return jsonify({
        "success": True,
        "message": "Budget set successfully!",
        "budget": budget_entry.to_dict()
    })


# ==========================================
# INCOME ROUTES
# ==========================================

@app.route("/api/income", methods=["GET"])
@token_required
def get_income(current_user):
    month_year = request.args.get("month") or datetime.now().strftime("%Y-%m")
    incomes = Income.query.filter(
        Income.user_id == current_user.id,
        Income.income_date.startswith(month_year)
    ).all()
    total_income = sum(i.amount for i in incomes)
    # Default to 50000 if not set yet, so existing dashboard balance matches expectations
    if total_income == 0 and len(incomes) == 0:
        total_income = 50000.0

    return jsonify({
        "success": True,
        "totalIncome": total_income,
        "incomes": [i.to_dict() for i in incomes]
    })


@app.route("/api/income", methods=["POST"])
@token_required
def set_income(current_user):
    data = request.get_json() or {}
    try:
        amount = float(data.get("amount", 0))
    except (ValueError, TypeError):
        return jsonify({"success": False, "message": "Invalid income amount."}), 400

    if amount <= 0:
        return jsonify({"success": False, "message": "Income must be greater than zero."}), 400

    source = (data.get("source") or "Monthly Income").strip()
    income_date = (data.get("date") or date.today().isoformat()).strip()

    income_entry = Income(
        user_id=current_user.id,
        amount=amount,
        source=source,
        income_date=income_date
    )
    db.session.add(income_entry)
    db.session.commit()

    return jsonify({
        "success": True,
        "message": "Income added successfully!",
        "income": income_entry.to_dict()
    }), 201


# ==========================================
# DASHBOARD SUMMARY & ANALYTICS
# ==========================================

@app.route("/api/dashboard-summary", methods=["GET"])
@token_required
def dashboard_summary(current_user):
    all_expenses = Expense.query.filter_by(user_id=current_user.id).all()
    total_expenses = sum(e.amount for e in all_expenses)

    # Incomes
    incomes = Income.query.filter_by(user_id=current_user.id).all()
    total_income = sum(i.amount for i in incomes) if incomes else 50000.0
    balance = total_income - total_expenses

    # 5 most recent transactions
    recent = Expense.query.filter_by(user_id=current_user.id)\
        .order_by(Expense.expense_date.desc(), Expense.id.desc())\
        .limit(5).all()

    return jsonify({
        "success": True,
        "totalIncome": total_income,
        "totalExpenses": total_expenses,
        "balance": balance,
        "recentTransactions": [e.to_dict() for e in recent]
    })


@app.route("/api/reports", methods=["GET"])
@token_required
def get_reports(current_user):
    month = request.args.get("month")
    query = Expense.query.filter_by(user_id=current_user.id)
    if month:
        query = query.filter(Expense.expense_date.startswith(month))

    expenses = query.all()
    total = sum(e.amount for e in expenses)
    count = len(expenses)

    categories = {}
    for exp in expenses:
        categories[exp.category] = categories.get(exp.category, 0.0) + exp.amount

    category_summary = []
    for cat, amt in categories.items():
        pct = (amt / total * 100) if total > 0 else 0
        category_summary.append({
            "category": cat,
            "amount": amt,
            "percentage": round(pct, 1)
        })

    category_summary.sort(key=lambda x: x["amount"], reverse=True)

    return jsonify({
        "success": True,
        "total": total,
        "count": count,
        "categories": category_summary
    })


# ==========================================
# STATIC FILE SERVING FOR FRONTEND
# ==========================================

@app.route("/")
def serve_index():
    return send_from_directory(BASE_DIR, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    if os.path.exists(os.path.join(BASE_DIR, path)):
        return send_from_directory(BASE_DIR, path)
    return send_from_directory(BASE_DIR, "index.html")


# ==========================================
# DATABASE INITIALIZATION
# ==========================================

def init_db():
    with app.app_context():
        db.create_all()
        print("[SmartSpend] SQLite database initialized successfully.")

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
