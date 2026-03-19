import express from "express";
import request from "supertest";
import { validateAttachmentsBatch, AttachmentAuthError } from "../security/attachmentAuth";

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.post("/api/conversations", async (req, res) => {
    const userId = req.headers["x-test-user-id"] as string;
    const isAdmin = req.headers["x-test-admin"] === "true";
    const { attachments } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      try {
        await validateAttachmentsBatch(userId, attachments, isAdmin);
      } catch (err: any) {
        if (err instanceof AttachmentAuthError) {
          return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    res.status(201).json({ success: true, message: "Created" });
  });

  app.post("/api/conversations/:id/messages", async (req, res) => {
    const userId = req.headers["x-test-user-id"] as string;
    const isAdmin = req.headers["x-test-admin"] === "true";
    const { attachments } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (attachments && Array.isArray(attachments) && attachments.length > 0) {
      try {
        await validateAttachmentsBatch(userId, attachments, isAdmin);
      } catch (err: any) {
        if (err instanceof AttachmentAuthError) {
          return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    res.status(201).json({ success: true, message: "Message added" });
  });

  app.post("/api/conversations/:id/retry", async (req, res) => {
    const userId = req.headers["x-test-user-id"] as string;
    const isAdmin = req.headers["x-test-admin"] === "true";
    const { storedAttachments } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (storedAttachments) {
      let parsedAttachments;
      try {
        const rawAttachments = typeof storedAttachments === "string"
          ? JSON.parse(storedAttachments)
          : storedAttachments;

        if (!Array.isArray(rawAttachments)) {
          return res.status(400).json({ success: false, message: "Invalid attachment data in stored message" });
        }
        for (const att of rawAttachments) {
          if (!att || typeof att.url !== "string" || att.url.trim() === "") {
            return res.status(400).json({ success: false, message: "Stored message contains malformed attachment" });
          }
        }
        parsedAttachments = rawAttachments;
      } catch {
        return res.status(400).json({ success: false, message: "Failed to parse stored attachments" });
      }

      if (parsedAttachments.length > 0) {
        try {
          await validateAttachmentsBatch(userId, parsedAttachments, isAdmin);
        } catch (err: any) {
          if (err instanceof AttachmentAuthError) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
          }
          return res.status(403).json({ success: false, message: "Access denied" });
        }
      }
    }

    res.json({ success: true, message: "Retry initiated" });
  });

  return app;
}

const tests: { name: string; fn: () => Promise<void> }[] = [];
function describe(name: string, fn: () => void) {
  console.log(`\n=== ${name} ===`);
  fn();
}
function it(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

describe("POST /api/conversations — forged attachment rejection", () => {
  it("rejects forged /uploads/ path (no ownership record)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-attacker")
      .send({
        attachments: [{ url: "/uploads/victim-secret-file.png", name: "stolen.png" }]
      });
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  });

  it("rejects forged /objects/ path when ACL denies", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-attacker")
      .send({
        attachments: [{ url: "/objects/.private/other-user/secret.pdf", name: "stolen.pdf" }]
      });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  it("rejects data: URI attachments", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-1")
      .send({
        attachments: [{ url: "data:image/png;base64,AAAA", name: "inline.png" }]
      });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  it("rejects unsafe external URLs", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-1")
      .send({
        attachments: [{ url: "https://evil.com/exploit.png", name: "evil.png" }]
      });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  it("rejects path traversal attempts", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-1")
      .send({
        attachments: [{ url: "/uploads/../../../etc/passwd", name: "passwd" }]
      });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  it("succeeds with no attachments", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations")
      .set("x-test-user-id", "user-1")
      .send({ attachments: [] });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  });
});

describe("POST /api/conversations/:id/messages — forged attachment rejection", () => {
  it("rejects forged /uploads/ in add-message", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/messages")
      .set("x-test-user-id", "user-attacker")
      .send({
        attachments: [{ url: "/uploads/other-user-file.png", name: "stolen.png" }]
      });
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  });

  it("rejects forged /objects/ in add-message", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/messages")
      .set("x-test-user-id", "user-attacker")
      .send({
        attachments: [{ url: "/objects/.private/other-user/doc.pdf", name: "stolen.pdf" }]
      });
    if (res.status < 400) throw new Error(`Expected 4xx, got ${res.status}`);
  });

  it("succeeds with no attachments in add-message", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/messages")
      .set("x-test-user-id", "user-1")
      .send({ attachments: [] });
    if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}`);
  });
});

describe("POST /api/conversations/:id/retry — stored attachment re-validation", () => {
  it("rejects retry with forged stored /uploads/ attachment", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/retry")
      .set("x-test-user-id", "user-attacker")
      .send({
        storedAttachments: [{ url: "/uploads/not-my-file.png", name: "stolen.png" }]
      });
    if (res.status !== 403) throw new Error(`Expected 403, got ${res.status}`);
  });

  it("rejects retry with malformed stored attachment (empty URL)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/retry")
      .set("x-test-user-id", "user-1")
      .send({
        storedAttachments: [{ url: "", name: "bad.png" }]
      });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  it("rejects retry when stored attachments cannot be parsed", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/retry")
      .set("x-test-user-id", "user-1")
      .send({
        storedAttachments: "not valid json {"
      });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  it("rejects retry with non-array stored attachments", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/retry")
      .set("x-test-user-id", "user-1")
      .send({
        storedAttachments: { url: "/uploads/file.png" }
      });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
  });

  it("succeeds retry with no stored attachments", async () => {
    const app = createTestApp();
    const res = await request(app)
      .post("/api/conversations/1/retry")
      .set("x-test-user-id", "user-1")
      .send({});
    if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  });
});

console.log("=== Attachment Auth Route Tests ===\n");

(async () => {
  let passed = 0;
  let failed = 0;
  const failures: { name: string; error: any }[] = [];

  for (const test of tests) {
    try {
      await test.fn();
      console.log(`  \u2713 ${test.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  \u2717 ${test.name}: ${err.message}`);
      failed++;
      failures.push({ name: test.name, error: err });
    }
  }

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  ${f.name}: ${f.error.message}`);
    }
  }
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
