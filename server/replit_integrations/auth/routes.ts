import type { Express } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { z } from "zod";
import { getUncachableStripeClient } from "../../stripeClient";

const updateProfileSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().max(100).default(""),
  email: z.string().email("Invalid email address").max(255),
});

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await authStorage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      res.set("Cache-Control", "no-store");
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  app.patch("/api/auth/profile", isAuthenticated, async (req: any, res) => {
    try {
      const { userId } = getAuth(req);
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { firstName, lastName, email } = parsed.data;

      const result = await authStorage.updateUserProfile(userId, { firstName, lastName, email });

      if (result.error) {
        return res.status(409).json({ message: result.error });
      }

      if (result.user?.stripeCustomerId) {
        try {
          const stripe = await getUncachableStripeClient();
          await stripe.customers.update(result.user.stripeCustomerId, {
            email,
            name: [firstName, lastName].filter(Boolean).join(" "),
          });
        } catch (stripeError) {
          console.error("Failed to update Stripe customer email:", stripeError);
        }
      }

      res.json(result.user);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });
}
