import express, { Request, Response } from "express";
import User from "../models/user";
import { check, validationResult } from "express-validator";
import verifyToken from "../middleware/auth";
import { setSessionCookie, signSessionToken } from "../lib/session";

const router = express.Router();

router.get("/me", verifyToken, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.userId).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Something went wrong" });
  }
});

router.put(
  "/me",
  verifyToken,
  [
    check("firstName").optional().isString().trim().isLength({ min: 1, max: 60 }),
    check("lastName").optional().isString().trim().isLength({ min: 1, max: 60 }),
    check("phone").optional().isString().trim().isLength({ max: 20 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg });
    }
    const update: Record<string, string> = {};
    for (const key of ["firstName", "lastName", "phone"]) {
      if (typeof req.body[key] === "string") update[key] = req.body[key].trim();
    }
    const user = await User.findByIdAndUpdate(req.userId, update, { new: true }).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  }
);

router.post(
  "/register",
  [
    check("firstName", "First name is required").isString().trim().isLength({ min: 1, max: 60 }),
    check("lastName", "Last name is required").isString().trim().isLength({ min: 1, max: 60 }),
    check("email", "Please enter a valid email address").isEmail(),
    check("password", "Password must be at least 6 characters").isLength({ min: 6, max: 128 }),
  ],
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: errors.array()[0].msg, errors: errors.array() });
    }

    try {
      const email = String(req.body.email).trim().toLowerCase();
      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(400).json({ message: "An account with this email already exists" });
      }

      // Only whitelisted fields - previously the whole body (including "role")
      // was passed straight into the model.
      const user = new User({
        firstName: String(req.body.firstName).trim(),
        lastName: String(req.body.lastName).trim(),
        email,
        password: req.body.password,
      });
      await user.save();

      const token = signSessionToken(String(user._id));
      setSessionCookie(res, token);

      return res.status(201).send({
        message: "User registered successfully",
        token,
        userId: user._id,
        user: {
          id: user._id,
          _id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      console.log(error);
      res.status(500).send({ message: "Something went wrong" });
    }
  }
);

export default router;
