const express = require("express");
const router = express.Router();
const memberController = require("../controllers/memberController");

// GET all members (supports query params: search, page, limit)
router.get("/", memberController.getMembers);

// GET a single member by ID
router.get("/:memberId", memberController.getMemberById);

// POST create a new member
router.post("/", memberController.createMember);

// PUT update an existing member by ID
router.put("/:memberId", memberController.updateMember);

// DELETE a member by ID
router.delete("/:memberId", memberController.deleteMember);

module.exports = router;
