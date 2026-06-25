require('dotenv').config();
const mysql = require('mysql2/promise');

async function seedCourses() {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'medecnepal'
        });

        console.log("Connected to MySQL. Seeding courses...");

        const courses = [
            {
                title: "Pre-Medical Entrance 2025",
                description: "Comprehensive foundation course covering Physics, Chemistry, Biology, and MAT.",
                price: 12999.00,
                image_url: "assets/img/hero-graphic.png"
            },
            {
                title: "CEE Physics Mastery",
                description: "Master Mechanics, Electrostatics, and Modern Physics with expert guidance.",
                price: 8999.00,
                image_url: "assets/img/hero-graphic.png"
            },
            {
                title: "Biology Crash Course",
                description: "High-yield topics in Botany and Zoology tailored for CEE.",
                price: 5999.00,
                image_url: "assets/img/hero-graphic.png"
            }
        ];

        for (const course of courses) {
            // Check if exists to avoid duplicates
            const [existing] = await connection.query('SELECT id FROM courses WHERE title = ?', [course.title]);
            if (existing.length === 0) {
                await connection.query(
                    'INSERT INTO courses (title, description, price, image_url) VALUES (?, ?, ?, ?)',
                    [course.title, course.description, course.price, course.image_url]
                );
                console.log(`✅ Seeded: ${course.title}`);
            } else {
                console.log(`⚠️ Skipped (already exists): ${course.title}`);
            }
        }

        await connection.end();
        console.log("🎉 Database seeding complete!");
    } catch (err) {
        console.error("❌ Error seeding database:", err.message);
    }
}

seedCourses();
