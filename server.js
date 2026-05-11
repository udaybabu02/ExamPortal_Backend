require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARE ---
// UPDATED: Explicit CORS Configuration
const corsOptions = {
  origin: [
    'http://localhost:5173', // Local frontend
    'https://admin-of-exam.vercel.app', // Live Admin Portal
    'https://exam-portal-frontend-coral.vercel.app' // Live Student Portal
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
};

app.use(cors(corsOptions)); 
app.use(express.json());

// --- DATABASE CONNECTION CONFIG ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 13699,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ssl: {
        rejectUnauthorized: false
    }
};

const pool = mysql.createPool(dbConfig);

// Startup Connection Test
pool.getConnection()
    .then(conn => {
        console.log(`✅ SUCCESS: Connected to Aiven Cloud Database: ${process.env.DB_NAME}`);
        conn.release();
    })
    .catch(err => {
        console.error("❌ CLOUD DB CONNECTION FAILED:", err.message);
        process.exit(1); 
    });

// --- HEALTH CHECK ---
app.get('/', (req, res) => res.send('ARMS Portal Backend is Active on Aiven Cloud'));

// ==========================================
// 👑 ADMIN PORTAL SECTOR (Steps 4, 5, 6, 7, 8, 9)
// ==========================================

/**
 * STEP 9: Analytics Dashboard
 * Provides total counts and performance ratios for the Admin Dashboard.
 */
app.get('/api/admin/analytics', async (req, res) => {
    try {
        const [students] = await pool.query('SELECT COUNT(*) as count FROM users');
        const [questions] = await pool.query('SELECT COUNT(*) as count FROM questions');
        const [results] = await pool.query('SELECT COUNT(*) as count, AVG(score_percentage) as avg_score FROM results');
        const [passFail] = await pool.query('SELECT status, COUNT(*) as count FROM results GROUP BY status');

        res.json({
            totalStudents: students[0].count,
            totalQuestions: questions[0].count,
            averageScore: parseFloat(results[0].avg_score || 0).toFixed(2),
            performance: passFail
        });
    } catch (error) {
        res.status(500).json({ message: "Analytics fetch failed" });
    }
});

/**
 * STEP 4: Question Management (CRUD)
 */
app.get('/api/questions', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM questions ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch questions" });
    }
});

app.post('/api/questions', async (req, res) => {
    try {
        const { subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty, marks } = req.body;
        const query = `INSERT INTO questions (subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty, marks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await pool.execute(query, [subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty || 'Medium', marks || 1]);
        res.status(201).json({ message: "Question added!" });
    } catch (error) {
        res.status(500).json({ error: "Database error" });
    }
});

app.post('/api/questions/bulk', async (req, res) => {
    try {
        const { questions } = req.body;
        const query = `INSERT INTO questions (subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty, marks) VALUES ?`;
        const values = questions.map(q => [
            q.subject, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.difficulty || 'Medium', q.marks || 1
        ]);
        await pool.query(query, [values]);
        res.status(201).json({ message: `${questions.length} questions imported!` });
    } catch (error) {
        res.status(500).json({ error: "Bulk insert failed" });
    }
});

app.put('/api/questions/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty, marks } = req.body;
        const query = `UPDATE questions SET subject=?, question_text=?, option_a=?, option_b=?, option_c=?, option_d=?, correct_answer=?, difficulty=?, marks=? WHERE id=?`;
        await pool.execute(query, [subject, question_text, option_a, option_b, option_c, option_d, correct_answer, difficulty, marks, id]);
        res.json({ message: "Updated successfully" });
    } catch (error) {
        res.status(500).json({ message: "Update failed" });
    }
});

/**
 * STEP 5 & 6: Exam Configuration & Management
 */
app.get('/api/admin/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch exams" });
    }
});

app.post('/api/admin/exams', async (req, res) => {
    try {
        const { subject, duration_minutes, total_questions } = req.body;
        const query = `INSERT INTO exams (subject, duration_minutes, total_questions, is_active) VALUES (?, ?, ?, TRUE)`;
        await pool.execute(query, [subject, duration_minutes || 30, total_questions || 10]);
        res.status(201).json({ message: "Exam created!" });
    } catch (error) {
        res.status(500).json({ error: "Creation failed" });
    }
});

app.put('/api/admin/exams/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;
        await pool.execute('UPDATE exams SET is_active = ? WHERE id = ?', [is_active, id]);
        res.json({ message: "Status updated" });
    } catch (error) {
        res.status(500).json({ message: "Toggle failed" });
    }
});

/**
 * STEP 7: Student Management
 */
app.get('/api/admin/users', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name, email, mobile, id_type, user_id_value, hall_ticket FROM users ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch users" });
    }
});

/**
 * STEP 8: Results & Reporting
 */
app.get('/api/admin/results', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM results ORDER BY id DESC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch results" });
    }
});

/**
 * UNIVERSAL DELETE (Steps 4 & 7)
 */
app.delete('/api/:table/:id', async (req, res) => {
    try {
        const { table, id } = req.params;
        const allowedTables = ['questions', 'users', 'exams', 'results'];
        if (!allowedTables.includes(table)) return res.status(400).send("Invalid Table");
        await pool.query(`DELETE FROM ?? WHERE id = ?`, [table, id]);
        res.json({ message: "Deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Delete failed" });
    }
});

// ==========================================
// 🎓 STUDENT ROUTES
// ==========================================

app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams WHERE is_active = TRUE');
        res.json(rows);
    } catch (error) {
        res.status(500).send("Error fetching exams");
    }
});

app.get('/api/questions/:subject', async (req, res) => {
    try {
        const subjectName = decodeURIComponent(req.params.subject);
        const query = `SELECT id, question_text, option_a, option_b, option_c, option_d, correct_answer FROM questions WHERE LOWER(subject) = LOWER(?) ORDER BY RAND() LIMIT 10`;
        const [rows] = await pool.query(query, [subjectName]);
        if (rows.length === 0) return res.status(404).json({ message: "No questions found." });
        res.json(rows);
    } catch (error) {
        res.status(500).json({ message: "Server Error" });
    }
});

app.post('/api/register', async (req, res) => {
    try {
        const { name, email, mobile, password, idType, userId, hallTicket } = req.body;
        const query = `INSERT INTO users (name, email, mobile, password, id_type, user_id_value, hall_ticket) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        await pool.query(query, [name, email.toLowerCase(), mobile, password, idType, userId, hallTicket]);
        res.status(201).json({ message: "Registration successful!" });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: "Email already registered." });
        res.status(500).json({ message: "Registration failed." });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
        if (rows.length === 0 || password !== rows[0].password) return res.status(401).json({ message: "Invalid credentials." });
        res.status(200).json({ message: "Login successful", user: { id: rows[0].id, name: rows[0].name, email: rows[0].email } });
    } catch (error) {
        res.status(500).json({ message: "Server error." });
    }
});

app.post('/api/results', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, studentName, examId, percentage, passed, totalQuestions, correctAnswers, wrongAnswers, answers } = req.body;
        await connection.beginTransaction();
        const [resultHeader] = await connection.execute(`INSERT INTO results (user_id, student_name, exam_id, score_percentage, status, total_questions, correct_count, wrong_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [userId, studentName, examId, percentage, passed ? 'PASSED' : 'FAILED', totalQuestions, correctAnswers, wrongAnswers]);
        const newResultId = resultHeader.insertId;
        const answerQuery = `INSERT INTO result_answers (result_id, question_id, user_answer, is_correct) VALUES (?, ?, ?, ?)`;
        for (const ans of answers) {
            const pureId = parseInt(ans.questionId.toString().replace(/\D/g, ''));
            await connection.execute(answerQuery, [newResultId, pureId, ans.selected, ans.isCorrect]);
        }
        await connection.commit();
        res.status(201).json({ message: "Result saved!" });
    } catch (error) {
        await connection.rollback();
        res.status(500).json({ message: "Failed to save results." });
    } finally {
        connection.release();
    }
});

app.listen(PORT, () => console.log(`🚀 Server on http://localhost:${PORT}`));