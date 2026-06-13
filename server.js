require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
    origin: [
        'http://localhost:5173', 
        'http://localhost:8081', 
        'https://admin-of-exam.vercel.app', 
        'https://exam-portal-frontend-coral.vercel.app'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
})); 
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: parseInt(process.env.DB_PORT) || 13699,
    ssl: { rejectUnauthorized: false },
    connectionLimit: 10
});

// Helper for database queries with timeout
const queryWithTimeout = async (sql, params, timeoutMs = 8000) => {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('DB_TIMEOUT')), timeoutMs);
    });
    try {
        return await Promise.race([pool.query(sql, params), timeoutPromise]);
    } finally {
        clearTimeout(timeoutHandle);
    }
};

// --- REGISTER ROUTE (Corrected to match DB schema) ---
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, mobile, idType, hallTicketNumber, userId } = req.body;
        
        if (!email || !password) return res.status(400).json({ success: false, message: "Missing fields" });

        // SQL updated to match your database columns: name, email, password, mobile, id_type, user_id_value, hall_ticket
        const sql = 'INSERT INTO users (name, email, password, mobile, id_type, user_id_value, hall_ticket) VALUES (?, ?, ?, ?, ?, ?, ?)';
        
        await queryWithTimeout(sql, [
            name || 'Student', 
            email, 
            password, 
            mobile || '', 
            idType || '', 
            (idType === 'college' ? userId : hallTicketNumber), // Maps to user_id_value
            hallTicketNumber // Maps to hall_ticket
        ]);
        
        res.status(201).json({ success: true, message: "Registration successful" });
    } catch (error) {
        console.error("❌ REGISTER ERROR:", error.message);
        res.status(500).json({ success: false, message: "Database error", details: error.message });
    }
});

// --- LOGIN ROUTE ---
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [users] = await queryWithTimeout('SELECT * FROM users WHERE email = ?', [email]);
        
        if (users.length > 0 && users[0].password === password) {
            res.json({ success: true, user: users[0] });
        } else {
            res.status(401).json({ success: false, message: "Invalid email or password" });
        }
    } catch (error) {
        console.error("❌ LOGIN ERROR:", error.message);
        res.status(500).json({ success: false, message: "Login server error" });
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));