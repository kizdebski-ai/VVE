import knex from "knex";
import config from "./knexfile";
import { v4 as uuidv4 } from "uuid";

const db = knex(config);

async function testSchema() {
    console.log("Starting schema verification...");

    const orgId = uuidv4();
    const teacherId = uuidv4();
    const studentId = uuidv4();
    const boardId = uuidv4();

    try {
        // 1. Insert Organization
        console.log("Inserting Organization...");
        await db("organizations").insert({
            id: orgId,
            name: "Test School",
        });
        console.log("✅ Organization inserted");

        // 2. Insert Teacher
        console.log("Inserting Teacher...");
        await db("teachers").insert({
            id: teacherId,
            organization_id: orgId,
            email: "teacher@test.com",
            full_name: "John Doe",
        });
        console.log("✅ Teacher inserted");

        // 3. Insert Magic Link
        console.log("Inserting Magic Link...");
        await db("teacher_magic_links").insert({
            teacher_id: teacherId,
            token_hash: "hashed_token_123",
            expires_at: new Date(Date.now() + 3600000), // 1 hour from now
        });
        console.log("✅ Magic Link inserted");

        // 4. Insert Student
        console.log("Inserting Student...");
        await db("students").insert({
            id: studentId,
            organization_id: orgId,
            teacher_id: teacherId,
            full_name: "Jane Student",
        });
        console.log("✅ Student inserted");

        // 5. Insert Board
        console.log("Inserting Board...");
        await db("boards").insert({
            id: boardId,
            organization_id: orgId,
            teacher_id: teacherId,
            student_id: studentId,
            title: "Math Lesson 1",
            student_token_hash: "student_token_hash_123",
            valid_until: new Date(Date.now() + 86400000), // 24 hours
        });
        console.log("✅ Board inserted");

        // 6. Verify Data
        const board = await db("boards").where({ id: boardId }).first();
        if (board && board.title === "Math Lesson 1") {
            console.log("✅ Data verification successful: Board found");
        } else {
            console.error("❌ Data verification failed: Board not found or incorrect");
        }

    } catch (error) {
        console.error("❌ Test failed:", error);
    } finally {
        // Cleanup
        console.log("Cleaning up...");
        await db("boards").where({ id: boardId }).del();
        await db("students").where({ id: studentId }).del();
        await db("teacher_magic_links").where({ teacher_id: teacherId }).del();
        await db("teachers").where({ id: teacherId }).del();
        await db("organizations").where({ id: orgId }).del();
        console.log("✅ Cleanup done");

        await db.destroy();
    }
}

testSchema();
