/* ==========================================================================
   SmartSpend - Frontend Application Script
   Connected to Flask REST API + SQLite Database
   ========================================================================== */

// Detect API Base: Use same origin if served via Flask on port 5000, else fallback to 127.0.0.1:5000
const API_BASE = (window.location.protocol === "http:" || window.location.protocol === "https:") && window.location.port === "5000"
    ? ""
    : "http://127.0.0.1:5000";

/* =========================
   AUTHENTICATION & ROUTE GUARD
========================= */

function isLoginPage() {
    const path = window.location.pathname.toLowerCase();
    return path.endsWith("index.html") || path === "/" || path === "" || path.endsWith("/");
}

function checkAuth() {
    const token = localStorage.getItem("smartSpendToken");
    const onLogin = isLoginPage();

    if (!token && !onLogin) {
        window.location.href = "index.html";
        return false;
    }
    if (token && onLogin) {
        window.location.href = "dashboard.html";
        return false;
    }
    return true;
}

// Execute route guard immediately
checkAuth();

function getAuthHeaders() {
    const token = localStorage.getItem("smartSpendToken");
    return {
        "Content-Type": "application/json",
        "Authorization": token ? `Bearer ${token}` : ""
    };
}

async function apiRequest(endpoint, options = {}) {
    options.headers = {
        ...getAuthHeaders(),
        ...(options.headers || {})
    };

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, options);

        if (response.status === 401) {
            localStorage.removeItem("smartSpendToken");
            localStorage.removeItem("smartSpendUser");
            localStorage.removeItem("loggedIn");
            if (!isLoginPage()) {
                alert("Session expired. Please log in again.");
                window.location.href = "index.html";
            }
            throw new Error("Unauthorized");
        }

        return response;
    } catch (err) {
        console.error(`API Error on ${endpoint}:`, err);
        throw err;
    }
}


/* =========================
   LOGIN
========================= */

async function login(event) {
    event.preventDefault();

    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;

    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            localStorage.setItem("smartSpendToken", data.token);
            localStorage.setItem("smartSpendUser", JSON.stringify(data.user));
            localStorage.setItem("loggedIn", "true");
            window.location.href = "dashboard.html";
        } else {
            alert(data.message || "Invalid email or password.");
        }
    } catch (err) {
        alert("Unable to reach backend server. Please verify that the Flask server is running at http://127.0.0.1:5000");
    }
}


/* =========================
   SIGN UP
========================= */

async function signup(event) {
    event.preventDefault();

    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (password !== confirmPassword) {
        alert("Passwords do not match.");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            localStorage.setItem("smartSpendToken", data.token);
            localStorage.setItem("smartSpendUser", JSON.stringify(data.user));
            localStorage.setItem("loggedIn", "true");
            alert("Account created successfully! Welcome to SmartSpend.");
            window.location.href = "dashboard.html";
        } else {
            alert(data.message || "Sign up failed.");
        }
    } catch (err) {
        alert("Unable to reach backend server. Please verify that the Flask server is running at http://127.0.0.1:5000");
    }
}

/* =========================
   DASHBOARD
========================= */

async function loadDashboard() {
    try {
        const res = await apiRequest("/api/dashboard-summary");
        if (!res.ok) return;

        const data = await res.json();

        const incomeEl = document.getElementById("dashboardIncome");
        const expenseEl = document.getElementById("dashboardExpense");
        const balanceEl = document.getElementById("dashboardBalance");
        const recentTable = document.getElementById("recentTransactions");
        const welcomeEl = document.getElementById("welcomeText");

        if (incomeEl) {
            incomeEl.innerText = "₹" + Number(data.totalIncome).toFixed(2);
        }

        if (expenseEl) {
            expenseEl.innerText = "₹" + Number(data.totalExpenses).toFixed(2);
        }

        if (balanceEl) {
            balanceEl.innerText = "₹" + Number(data.balance).toFixed(2);
            balanceEl.style.color = data.balance < 0 ? "#dc2626" : "#087f5b";
        }

        const user = JSON.parse(localStorage.getItem("smartSpendUser") || "{}");

        if (welcomeEl && user.name) {
            welcomeEl.innerText = `Hello, ${user.name}! Here's your financial summary.`;
        }

        if (recentTable) {
            recentTable.innerHTML = "";

            if (!data.recentTransactions || data.recentTransactions.length === 0) {
                recentTable.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; color: #6b7280; padding: 20px;">
                            No transactions recorded yet.
                        </td>
                    </tr>
                `;
            } else {
                data.recentTransactions.forEach(expense => {
                    const row = document.createElement("tr");

                    row.innerHTML = `
                        <td>${expense.date}</td>
                        <td>${expense.category}</td>
                        <td>${expense.description}</td>
                        <td>${expense.paymentMethod}</td>
                        <td style="font-weight: bold; color: #dc2626;">
                            ₹${Number(expense.amount).toFixed(2)}
                        </td>
                    `;

                    recentTable.appendChild(row);
                });
            }
        }

    } catch (err) {
        console.error("Error loading dashboard:", err);
    }
}



/* =========================
   DYNAMIC INCOME PROMPT
========================= */

async function updateIncomePrompt() {
    const currentIncomeEl = document.getElementById("dashboardIncome");
    const currentVal = currentIncomeEl ? currentIncomeEl.innerText.replace("₹", "").trim() : "50000";
    const newIncome = prompt("Enter your monthly income (₹):", currentVal);

    if (newIncome === null) return;
    const amount = parseFloat(newIncome);

    if (isNaN(amount) || amount <= 0) {
        alert("Please enter a valid positive income amount.");
        return;
    }

    try {
        const res = await apiRequest("/api/income", {
            method: "POST",
            body: JSON.stringify({
                amount: amount,
                source: "Monthly Income",
                date: new Date().toISOString().split("T")[0]
            })
        });

        const data = await res.json();
        if (res.ok && data.success) {
            alert("Income updated successfully!");
            loadDashboard();
        } else {
            alert(data.message || "Failed to update income.");
        }
    } catch (err) {
        alert("Error updating income.");
    }
}


/* =========================
   ADD EXPENSE
========================= */

async function addExpense(event) {
    event.preventDefault();

    const amount = parseFloat(document.getElementById("amount").value);
    const category = document.getElementById("category").value;
    const date = document.getElementById("expenseDate").value;
    const description = document.getElementById("description").value;
    const paymentMethod = document.getElementById("paymentMethod").value;

    try {
        const res = await apiRequest("/api/expenses", {
            method: "POST",
            body: JSON.stringify({
                amount: amount,
                category: category,
                date: date,
                description: description || "No description",
                paymentMethod: paymentMethod
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            alert("Expense added successfully!");
            window.location.href = "history.html";
        } else {
            alert(data.message || "Failed to save expense.");
        }
    } catch (err) {
        alert("Error saving expense to server.");
    }
}


/* =========================
   EXPENSE HISTORY
========================= */
async function loadHistory()
 {
    const table = document.getElementById("historyTable");
    if (!table) return;

    try {
        const res = await apiRequest("/api/expenses");
        if (!res.ok) return;

        const data = await res.json();
        const expenses = data.expenses || [];
        window.smartSpendExpenses = expenses;

        table.innerHTML = "";

        if (expenses.length === 0) {
            table.innerHTML = `
                <tr>
                    <td colspan="6" style="text-align:center; padding: 25px; color: #6b7280;">
                        No expenses added yet.
                    </td>
                </tr>
            `;
            return;
        }

        expenses.forEach(expense => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${expense.date}</td>
                <td>${expense.category}</td>
                <td>${expense.description}</td>
                <td>${expense.paymentMethod}</td>
                <td style="font-weight: bold; color: #dc2626;">
                    ₹${Number(expense.amount).toFixed(2)}
                </td>
                <td>
    <button
    class="primary-btn"
    onclick="editExpense(${expense.id})">
    Edit
</button>

    <button
        class="delete-btn"
        onclick="deleteExpense(${expense.id})">
        Delete
    </button>
</td>
            `;
            table.appendChild(row);
        });
    } catch (err) {
        console.error("Error loading history:", err);
    }
}
/* =========================
   MONTHLY SPENDING CHART
========================= */

let monthlyChartInstance = null;

async function loadMonthlySpendingChart() {
    const canvas = document.getElementById("monthlySpendingChart");

    if (!canvas) return;

    try {
        const res = await apiRequest("/api/expenses");

        if (!res.ok) {
            console.error("Could not load expenses for chart.");
            return;
        }

        const data = await res.json();
        const expenses = data.expenses || [];

        const monthlyTotals = {};
        const today = new Date();

        // Prepare the last 6 months
        for (let i = 5; i >= 0; i--) {
            const date = new Date(
                today.getFullYear(),
                today.getMonth() - i,
                1
            );

            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

            monthlyTotals[key] = 0;
        }

        // Calculate actual monthly expenses
        expenses.forEach(expense => {
            const date = new Date(expense.date + "T00:00:00");

            if (isNaN(date.getTime())) return;

            const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

            if (Object.prototype.hasOwnProperty.call(monthlyTotals, key)) {
                monthlyTotals[key] += Number(expense.amount) || 0;
            }
        });

        const labels = Object.keys(monthlyTotals).map(key => {
            const [year, month] = key.split("-");
            return new Date(Number(year), Number(month) - 1)
                .toLocaleString("en-IN", { month: "short", year: "numeric" });
        });

        const amounts = Object.values(monthlyTotals);

        if (monthlyChartInstance) {
            monthlyChartInstance.destroy();
        }

        monthlyChartInstance = new Chart(canvas, {
            type: "bar",

            data: {
                labels: labels,

                datasets: [{
                    label: "Monthly Expenses (₹)",
                    data: amounts,
                    backgroundColor: "#6366f1",
                    borderRadius: 8,
                    barThickness: 35
                }]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: {
                        display: false
                    },

                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return "₹" + context.parsed.y.toFixed(2);
                            }
                        }
                    }
                },

                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return "₹" + value;
                            }
                        }
                    }
                }
            }
        });

    } catch (err) {
        console.error("Monthly chart error:", err);
    }
}

/* =========================
   DELETE EXPENSE
========================= */

async function deleteExpense(id) {
    if (!confirm("Are you sure you want to delete this expense?")) {
        return;
    }

    try {
        const res = await apiRequest(`/api/expenses/${id}`, {
            method: "DELETE"
        });

        const data = await res.json();

        if (res.ok && data.success) {
            loadHistory();
        } else {
            alert(data.message || "Failed to delete expense.");
        }
    } catch (err) {
        alert("Error deleting expense.");
    }
}


/* =========================
   BUDGET MANAGEMENT
========================= */


async function loadBudget() {
    try {
        const res = await apiRequest("/api/budget");
        if (!res.ok) return;

        const data = await res.json();

        // Use the saved budget; show ₹10,000 when no budget exists yet.
        const budget = Number(data.budget) || 10000;
        const spent = Number(data.spent) || 0;
        const remaining = Number.isFinite(Number(data.remaining))
            ? Number(data.remaining)
            : budget - spent;

        const budgetElement = document.getElementById("currentBudget");
        const spentElement = document.getElementById("budgetSpent");
        const remainingElement = document.getElementById("budgetRemaining");
        const input = document.getElementById("budgetAmount");

        const percentElement = document.getElementById("budgetPercent");
        const bar = document.getElementById("budgetProgressBar");
        const track = document.getElementById("budgetProgressTrack");
        const caption = document.getElementById("budgetProgressCaption");
        const alertBox = document.getElementById("budgetAlert");

        const percent = budget > 0 ? (spent / budget) * 100 : 0;
        const progress = Math.min(100, Math.max(0, percent));

        if (budgetElement) {
            budgetElement.textContent = "₹" + budget.toFixed(2);
        }

        if (spentElement) {
            spentElement.textContent = "₹" + spent.toFixed(2);
        }

        if (remainingElement) {
            remainingElement.textContent = "₹" + remaining.toFixed(2);
            remainingElement.style.color =
                remaining < 0 ? "#dc2626" : "#087f5b";
        }

        // Prefill the editable input with the current budget.
        if (input && document.activeElement !== input) {
            input.value = budget.toFixed(2);
        }

        if (percentElement) {
            percentElement.textContent = Math.round(percent) + "%";
        }

        if (bar) {
            bar.style.width = progress + "%";
            bar.classList.toggle(
                "is-warning", percent >= 80 && percent < 100
            );
            bar.classList.toggle("is-over", percent >= 100);
        }

        if (track) {
            track.setAttribute("aria-valuenow", String(Math.round(progress)));
        }

        if (caption) {
            caption.textContent =
                `You have spent ₹${spent.toFixed(2)} of ₹${budget.toFixed(2)}.`;
        }

        if (alertBox) {
            alertBox.hidden = true;
            alertBox.className = "budget-alert";
            alertBox.textContent = "";

            if (percent >= 100) {
                alertBox.hidden = false;
                alertBox.classList.add("is-danger");
                alertBox.textContent =
                    `Budget limit reached! You have used ${Math.round(percent)}% of your budget.`;
            } else if (percent >= 80) {
                alertBox.hidden = false;
                alertBox.classList.add("is-warning");
                alertBox.textContent =
                    `Budget warning! You have used ${Math.round(percent)}% of your budget.`;
            }
        }
    } catch (err) {
        console.error("Error loading budget:", err);
    }
}



async function setBudget() {
    const input = document.getElementById("budgetAmount");
    const amount = Number(input.value);

    if (!Number.isFinite(amount) || amount <= 0) {
        alert("Please enter a budget greater than ₹0.");
        input.focus();
        return;
    }

    try {
        const res = await apiRequest("/api/budget", {
            method: "POST",
            body: JSON.stringify({ amount })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            alert("Monthly budget saved successfully!");
            await loadBudget();
        } else {
            alert(data.message || "Failed to save budget.");
        }
    } catch (err) {
        console.error("Error saving budget:", err);
        alert("Could not save the budget. Check that Flask is running.");
    }
}


/* =========================
   REPORTS & ANALYTICS
========================= */

let categoryChartInstance = null;

async function loadReports() {
    try {
        const res = await apiRequest("/api/reports");
        if (!res.ok) return;

        const data = await res.json();

        const totalElement = document.getElementById("reportTotal");
        const countElement = document.getElementById("reportCount");
        const categoryReport = document.getElementById("categoryReport");
        const chartCanvas = document.getElementById("categoryChart");

        if (totalElement) {
            totalElement.innerText = "₹" + Number(data.total).toFixed(2);
        }

        if (countElement) {
            countElement.innerText = data.count;
        }

        if (categoryChartInstance) {
            categoryChartInstance.destroy();
            categoryChartInstance = null;
        }

        if (categoryReport) {
            categoryReport.innerHTML = "";
        }

        if (!data.categories || data.categories.length === 0) {
            if (categoryReport) {
                categoryReport.innerHTML = `
                    <p style="color:#6b7280;padding:15px 0;">
                        No expenses recorded yet.
                    </p>
                `;
            }
            return;
        }

        // Create category doughnut chart
        if (chartCanvas && typeof Chart !== "undefined") {
            categoryChartInstance = new Chart(chartCanvas, {
                type: "doughnut",

                data: {
                    labels: data.categories.map(item => item.category),

                    datasets: [{
                        data: data.categories.map(item =>
                            Number(item.amount)
                        ),
                        backgroundColor: [
                            "#6366f1",
                            "#06b6d4",
                            "#f59e0b",
                            "#10b981",
                            "#ec4899",
                            "#8b5cf6",
                            "#f97316"
                        ],
                        borderWidth: 2,
                        borderColor: "#ffffff"
                    }]
                },

                options: {
                    responsive: true,
                    maintainAspectRatio: false,

                    plugins: {
                        legend: {
                            position: "bottom"
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return context.label + ": ₹" +
                                        Number(context.raw).toFixed(2);
                                }
                            }
                        }
                    }
                }
            });
        }

        // Keep existing category progress bars
        if (categoryReport) {
            data.categories.forEach(item => {
                const div = document.createElement("div");
                div.className = "category-row";

                div.innerHTML = `
                    <div class="category-header">
                        <span>${item.category}</span>
                        <span>
                            ₹${Number(item.amount).toFixed(2)}
                            (${item.percentage}%)
                        </span>
                    </div>

                    <div class="progress">
                        <div
                            class="progress-bar"
                            style="width:${Math.min(item.percentage, 100)}%;">
                        </div>
                    </div>
                `;

                categoryReport.appendChild(div);
            });
        }

    } catch (err) {
        console.error("Error loading reports:", err);
    }
}


/* =========================
   LOGOUT
========================= */

function logout() {
    localStorage.removeItem("smartSpendToken");
    localStorage.removeItem("smartSpendUser");
    localStorage.removeItem("loggedIn");
    window.location.href = "index.html";
}
/* =========================
   EDIT EXPENSE
========================= */

async function editExpense(id) {
    const expense = (window.smartSpendExpenses || [])
        .find(item => Number(item.id) === Number(id));

    if (!expense) {
        alert("Expense not found. Please refresh the page.");
        return;
    }

    // Get updated values
    const amountInput = prompt(
        "Enter expense amount:",
        expense.amount
    );
    if (amountInput === null) return;

    const amount = Number(amountInput);

    if (!Number.isFinite(amount) || amount <= 0) {
        alert("Please enter a valid amount greater than zero.");
        return;
    }

    const category = prompt(
        "Enter category:",
        expense.category
    );
    if (category === null) return;

    if (!category.trim()) {
        alert("Category cannot be empty.");
        return;
    }

    const date = prompt(
        "Enter date (YYYY-MM-DD):",
        expense.date
    );
    if (date === null) return;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        alert("Please enter the date in YYYY-MM-DD format.");
        return;
    }

    const description = prompt(
        "Enter description:",
        expense.description
    );
    if (description === null) return;

    const paymentMethod = prompt(
        "Enter payment method:",
        expense.paymentMethod
    );
    if (paymentMethod === null) return;

    if (!paymentMethod.trim()) {
        alert("Payment method cannot be empty.");
        return;
    }

    try {
        const res = await apiRequest(`/api/expenses/${id}`, {
            method: "PUT",
            body: JSON.stringify({
                amount: amount,
                category: category.trim(),
                date: date,
                description: description.trim(),
                paymentMethod: paymentMethod.trim()
            })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            alert("Expense updated successfully!");
            await loadHistory();
        } else {
            alert(data.message || "Failed to update expense.");
        }

    } catch (err) {
        console.error("Edit expense error:", err);
        alert("Error updating expense. Please try again.");
    }
}

/* =========================
   EXPORT EXPENSES TO CSV
========================= */

async function exportExpensesCSV() {
    try {
        const res = await apiRequest("/api/expenses");

        if (!res.ok) {
            alert("Unable to export expenses.");
            return;
        }

        const data = await res.json();
        const expenses = data.expenses || [];

        if (expenses.length === 0) {
            alert("No expenses available to export.");
            return;
        }

        const headers = [
            "Date",
            "Category",
            "Description",
            "Payment Method",
            "Amount"
        ];

        const rows = expenses.map(expense => [
            expense.date,
            expense.category,
            expense.description,
            expense.paymentMethod,
            expense.amount
        ]);

        const escapeCSV = value => {
            let text = String(value ?? "");
            return '"' + text.replace(/"/g, '""') + '"';
        };

        const csvContent = [
            headers.map(escapeCSV).join(","),
            ...rows.map(row => row.map(escapeCSV).join(","))
        ].join("\n");

        const blob = new Blob(
            ["\uFEFF" + csvContent],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = "SmartSpend_Expenses.csv";

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);

        alert("Expenses exported successfully!");

    } catch (err) {
        console.error("CSV export error:", err);
        alert("Something went wrong while exporting expenses.");
    }
}