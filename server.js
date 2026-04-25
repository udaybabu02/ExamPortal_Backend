require('dotenv').config(); 
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5000;

// --- MIDDLEWARE ---
app.use(cors()); 
app.use(express.json());

// --- DATABASE CONNECTION ---
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
};

// SSL Config for Cloud DBs
if (process.env.DB_HOST && process.env.DB_HOST !== 'localhost') {
    dbConfig.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
}

const pool = mysql.createPool(dbConfig);

// Startup Connection Test
pool.getConnection()
    .then(conn => {
        console.log(`✅ Connected to Database: ${process.env.DB_NAME}`);
        conn.release();
    })
    .catch(err => {
        console.error("❌ DB Connection Failed:", err.message);
        process.exit(1); 
    });

// --- ROUTES ---

// Health Check
app.get('/', (req, res) => res.send('ARMS Portal Backend is Active'));

// 1. Get Active Exams
app.get('/api/exams', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM exams WHERE is_active = TRUE');
        res.json(rows);
    } catch (error) {
        console.error("Exams Error:", error);
        res.status(500).json({ message: "Failed to fetch exams" });
    }
});

// 2. STRICT EXAM PATTERN: 10 Random Questions Per User
app.get('/api/questions/:subject', async (req, res) => {
    try {
        const subjectName = decodeURIComponent(req.params.subject);
        console.log(`🔍 Generating strict exam set for: "${subjectName}"`);

        // ORDER BY RAND() shuffles the questions differently for every single user.
        // LIMIT 10 ensures they only ever get exactly 10 questions.
        const query = `
            SELECT id, question_text, option_a, option_b, option_c, option_d, correct_answer 
            FROM questions 
            WHERE LOWER(subject) = LOWER(?) 
            ORDER BY RAND() 
            LIMIT 10 
        `;
        const [rows] = await pool.query(query, [subjectName]);
        
        console.log(`📊 Result: Distributed ${rows.length} random questions.`);

        if (rows.length === 0) {
            return res.status(404).json({ message: "No questions found for this subject." });
        }
        
        res.json(rows);
    } catch (error) {
        console.error("❌ Questions Error:", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// 3. User Registration
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, mobile, password, idType, userId, hallTicket } = req.body;
        console.log(`👤 New Registration: ${email}`);

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const query = `
            INSERT INTO users (name, email, mobile, password, id_type, user_id_value, hall_ticket)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        
        await pool.query(query, [name, email.toLowerCase(), mobile, hashedPassword, idType, userId, hallTicket]);
        res.status(201).json({ message: "Registration successful!" });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: "Email already registered." });
        }
        console.error("❌ Registration Error:", error.message);
        res.status(500).json({ message: "Registration failed." });
    }
});

// 4. User Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        console.log(`🔑 Login attempt: ${email}`);

        const [rows] = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
        
        if (rows.length === 0) return res.status(401).json({ message: "Invalid credentials." });

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);

        if (!isMatch) return res.status(401).json({ message: "Invalid credentials." });

        console.log(`✅ Login Success: ${user.name}`);
        res.status(200).json({
            message: "Login successful",
            user: { id: user.id, name: user.name, email: user.email }
        });
    } catch (error) {
        console.error("❌ Login Error:", error);
        res.status(500).json({ message: "Internal server error." });
    }
});

// 5. Save Exam Results
app.post('/api/results', async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { userId, examId, percentage, passed, totalQuestions, correctAnswers, wrongAnswers, answers } = req.body;
        await connection.beginTransaction();

        const [resultHeader] = await connection.execute(
            `INSERT INTO results (user_id, exam_id, score_percentage, status, total_questions, correct_count, wrong_count) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, examId, percentage, passed ? 'PASSED' : 'FAILED', totalQuestions, correctAnswers, wrongAnswers]
        );

        const newResultId = resultHeader.insertId;
        const answerQuery = `INSERT INTO result_answers (result_id, question_id, user_answer, is_correct) VALUES (?, ?, ?, ?)`;

        for (const ans of answers) {
            const pureId = parseInt(ans.questionId.toString().replace(/\D/g, ''));
            await connection.execute(answerQuery, [newResultId, pureId, ans.selected, ans.isCorrect]);
        }

        await connection.commit();
        console.log(`📊 Results saved for User ID: ${userId}`);
        res.status(201).json({ message: "Result saved!" });
    } catch (error) {
        await connection.rollback();
        console.error("❌ Results Save Error:", error);
        res.status(500).json({ message: "Failed to save results." });
    } finally {
        connection.release();
    }
});

// 6. Get User's Completed Exams (For enforcing strict completion)
app.get('/api/user/completed-exams/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        // Find all unique exams this user has submitted
        const [rows] = await pool.query(
            'SELECT DISTINCT exam_id FROM results WHERE user_id = ?', 
            [userId]
        );
        
        // Convert to a simple array of exam names: ['Java Exam', 'Python Exam']
        const completedExams = rows.map(row => row.exam_id);
        res.json(completedExams);
    } catch (error) {
        console.error("❌ Progress Fetch Error:", error);
        res.status(500).json({ message: "Failed to fetch user progress." });
    }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));