require('dotenv').config();
const mysql = require('mysql2/promise');

async function fixTable() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 13699,
        ssl: { rejectUnauthorized: false }
    });

    try {
        console.log("🛠️ Updating database schema for Admin Portal requirements...");
        
        // Fix Questions Table (Step 4)
        await connection.query(`
            ALTER TABLE questions 
            ADD COLUMN IF NOT EXISTS difficulty VARCHAR(20) DEFAULT 'Medium',
            ADD COLUMN IF NOT EXISTS marks INT DEFAULT 1;
        `);

        // Fix Exams Table for Dynamic Config (Step 5 & 6)
        await connection.query(`
            ALTER TABLE exams 
            ADD COLUMN IF NOT EXISTS duration_minutes INT DEFAULT 30,
            ADD COLUMN IF NOT EXISTS total_questions INT DEFAULT 10;
        `);

        console.log("✅ SUCCESS: Database schema updated for all 11 steps!");
    } catch (err) {
        console.error("❌ ERROR:", err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

fixTable();