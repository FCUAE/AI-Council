import { normalizeAttachmentUrl, validateAttachmentAccess, validateAttachmentsBatch, AttachmentAuthError } from "../security/attachmentAuth";
import { db } from "../db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

function describe(name: string, fn: () => void) {
  console.log(`\n=== ${name} ===`);
  fn();
}

let testQueue: { name: string; fn: () => Promise<void> }[] = [];

function it(name: string, fn: () => Promise<void>) {
  testQueue.push({ name, fn });
}

async function runTests() {
  let passed = 0;
  let failed = 0;
  const failures: { name: string; error: any }[] = [];

  for (const test of testQueue) {
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
  return { passed, failed };
}

describe("normalizeAttachmentUrl", () => {
  it("normalizes simple /uploads/ path", async () => {
    const result = normalizeAttachmentUrl("/uploads/test-file.png");
    if (result !== "/uploads/test-file.png") throw new Error(`Expected /uploads/test-file.png, got ${result}`);
  });

  it("strips query strings", async () => {
    const result = normalizeAttachmentUrl("/uploads/file.png?token=abc");
    if (result !== "/uploads/file.png") throw new Error(`Expected /uploads/file.png, got ${result}`);
  });

  it("strips fragments", async () => {
    const result = normalizeAttachmentUrl("/uploads/file.png#section");
    if (result !== "/uploads/file.png") throw new Error(`Expected /uploads/file.png, got ${result}`);
  });

  it("decodes URL-encoded characters", async () => {
    const result = normalizeAttachmentUrl("/uploads/test%20file.png");
    if (result !== "/uploads/test file.png") throw new Error(`Expected /uploads/test file.png, got ${result}`);
  });

  it("collapses duplicate slashes", async () => {
    const result = normalizeAttachmentUrl("/uploads///file.png");
    if (result !== "/uploads/file.png") throw new Error(`Expected /uploads/file.png, got ${result}`);
  });

  it("resolves path traversal attempts", async () => {
    const result = normalizeAttachmentUrl("/uploads/../../../etc/passwd");
    if (result.includes("..")) throw new Error("Path traversal not resolved");
    if (result.startsWith("/uploads/")) throw new Error("Traversal should escape /uploads/ prefix");
    if (result !== "/etc/passwd") throw new Error(`Expected /etc/passwd (escaped uploads), got ${result}`);
  });

  it("resolves dot segments", async () => {
    const result = normalizeAttachmentUrl("/uploads/./file.png");
    if (result !== "/uploads/file.png") throw new Error(`Expected /uploads/file.png, got ${result}`);
  });

  it("rejects empty URL", async () => {
    try {
      normalizeAttachmentUrl("");
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
    }
  });

  it("handles absolute HTTP URLs by extracting path", async () => {
    const result = normalizeAttachmentUrl("https://example.com/uploads/file.png?q=1");
    if (result !== "/uploads/file.png") throw new Error(`Expected /uploads/file.png, got ${result}`);
  });

  it("rejects malformed absolute URLs", async () => {
    try {
      normalizeAttachmentUrl("http://[invalid");
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.reason !== "malformed_url") throw new Error(`Expected malformed_url, got ${err.reason}`);
    }
  });

  it("handles /objects/ paths", async () => {
    const result = normalizeAttachmentUrl("/objects/public/image.png");
    if (result !== "/objects/public/image.png") throw new Error(`Expected /objects/public/image.png, got ${result}`);
  });

  it("strips query from /objects/ path", async () => {
    const result = normalizeAttachmentUrl("/objects/public/image.png?token=abc");
    if (result !== "/objects/public/image.png") throw new Error(`Expected /objects/public/image.png, got ${result}`);
  });

  it("normalizes data: URIs to path form (rejected at validation layer)", async () => {
    const result = normalizeAttachmentUrl("data:image/png;base64,abc");
    if (!result.startsWith("/")) throw new Error("data: URIs get normalized to path form which is then rejected by validateAttachmentAccess");
  });

  it("rejects malformed percent-encoding in relative URLs", async () => {
    try {
      normalizeAttachmentUrl("/uploads/file%ZZbad.png");
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.reason !== "malformed_encoding") throw new Error(`Expected malformed_encoding, got ${err.reason}`);
    }
  });
});

describe("validateAttachmentAccess — /uploads/ ownership (DB-backed)", () => {
  it("rejects if no file_uploads ownership record exists (file existence != auth)", async () => {
    try {
      await validateAttachmentAccess("user-1", "/uploads/orphan-file.png", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
      if (err.reason !== "no_ownership_record") throw new Error(`Expected no_ownership_record, got ${err.reason}`);
    }
  });

  it("allows access when user owns the file (DB record exists)", async () => {
    const testFilename = `test-owned-${randomUUID()}.png`;
    const testUserId = `test-owner-${randomUUID()}`;
    await db.execute(
      sql`INSERT INTO file_uploads (filename, user_id, purpose) VALUES (${testFilename}, ${testUserId}, 'test')`
    );
    try {
      await validateAttachmentAccess(testUserId, `/uploads/${testFilename}`, false);
    } finally {
      await db.execute(sql`DELETE FROM file_uploads WHERE filename = ${testFilename}`);
    }
  });

  it("rejects when different user tries to access owned file", async () => {
    const testFilename = `test-owned-${randomUUID()}.png`;
    const ownerUserId = `test-owner-${randomUUID()}`;
    const attackerUserId = `test-attacker-${randomUUID()}`;
    await db.execute(
      sql`INSERT INTO file_uploads (filename, user_id, purpose) VALUES (${testFilename}, ${ownerUserId}, 'test')`
    );
    try {
      await validateAttachmentAccess(attackerUserId, `/uploads/${testFilename}`, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.reason !== "not_owner") throw new Error(`Expected not_owner, got ${err.reason}`);
    } finally {
      await db.execute(sql`DELETE FROM file_uploads WHERE filename = ${testFilename}`);
    }
  });

  it("admin override allows access to another user's file", async () => {
    const testFilename = `test-admin-${randomUUID()}.png`;
    const ownerUserId = `test-owner-${randomUUID()}`;
    const adminUserId = `test-admin-${randomUUID()}`;
    await db.execute(
      sql`INSERT INTO file_uploads (filename, user_id, purpose) VALUES (${testFilename}, ${ownerUserId}, 'test')`
    );
    try {
      await validateAttachmentAccess(adminUserId, `/uploads/${testFilename}`, true);
    } finally {
      await db.execute(sql`DELETE FROM file_uploads WHERE filename = ${testFilename}`);
    }
  });

  it("admin still denied when no ownership record exists", async () => {
    try {
      await validateAttachmentAccess("admin-user", `/uploads/nonexistent-${randomUUID()}.png`, true);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.reason !== "no_ownership_record") throw new Error(`Expected no_ownership_record, got ${err.reason}`);
    }
  });
});

describe("validateAttachmentsBatch", () => {
  it("rejects entire batch on first failure", async () => {
    const attachments = [
      { url: `/uploads/legit-${randomUUID()}.png`, name: "a.png" },
      { url: `/uploads/stolen-${randomUUID()}.png`, name: "b.png" }
    ];
    try {
      await validateAttachmentsBatch("user-1", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
    }
  });

  it("batch succeeds when owner has records for all files", async () => {
    const testUserId = `test-batch-owner-${randomUUID()}`;
    const file1 = `batch-a-${randomUUID()}.png`;
    const file2 = `batch-b-${randomUUID()}.png`;
    await db.execute(
      sql`INSERT INTO file_uploads (filename, user_id, purpose) VALUES (${file1}, ${testUserId}, 'test')`
    );
    await db.execute(
      sql`INSERT INTO file_uploads (filename, user_id, purpose) VALUES (${file2}, ${testUserId}, 'test')`
    );
    try {
      await validateAttachmentsBatch(testUserId, [
        { url: `/uploads/${file1}`, name: "a.png" },
        { url: `/uploads/${file2}`, name: "b.png" }
      ], false);
    } finally {
      await db.execute(sql`DELETE FROM file_uploads WHERE filename IN (${file1}, ${file2})`);
    }
  });
});

describe("URL normalization edge cases", () => {
  it("handles double-encoded percent", async () => {
    const result = normalizeAttachmentUrl("/uploads/test%2520file.png");
    if (!result.includes("uploads")) throw new Error(`Unexpected result: ${result}`);
  });

  it("handles null byte injection attempt", async () => {
    try {
      const result = normalizeAttachmentUrl("/uploads/test\0.png");
      if (result.includes("\0")) throw new Error("Null byte should be rejected");
    } catch (err: any) {
      if (err instanceof AttachmentAuthError && err.reason === "traversal_attempt") return;
      throw err;
    }
  });

  it("rejects unknown URL patterns", async () => {
    try {
      await validateAttachmentAccess("user-1", "/api/secret-data", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
      if (err.reason !== "unknown_url_pattern") throw new Error(`Expected unknown_url_pattern, got ${err.reason}`);
    }
  });

  it("rejects data: URIs at ingestion", async () => {
    try {
      await validateAttachmentAccess("user-1", "data:image/png;base64,abc123", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
      if (err.reason !== "unknown_url_pattern") throw new Error(`Expected unknown_url_pattern, got ${err.reason}`);
    }
  });

  it("rejects unsafe external URLs", async () => {
    try {
      await validateAttachmentAccess("user-1", "https://evil.com/hack.png", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
    }
  });
});

describe("ingestion-level validation scenarios", () => {
  it("rejects batch with forged /uploads/ (no ownership)", async () => {
    const attachments = [
      { url: `/uploads/forged-${randomUUID()}.png`, name: "stolen.png" }
    ];
    try {
      await validateAttachmentsBatch("user-attacker", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
    }
  });

  it("rejects batch with data: URI", async () => {
    try {
      await validateAttachmentsBatch("user-1", [{ url: "data:image/png;base64,AAAA", name: "inline.png" }], false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
    }
  });

  it("rejects batch with path traversal", async () => {
    try {
      await validateAttachmentsBatch("user-1", [{ url: "/uploads/../../../etc/passwd", name: "passwd" }], false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
    }
  });

  it("admin override allows /objects/ without ACL check", async () => {
    await validateAttachmentAccess("admin-user", "/objects/public/shared-file.png", true);
  });

  it("rejects empty URL in batch", async () => {
    try {
      await validateAttachmentsBatch("user-1", [{ url: "", name: "bad.png" }], false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
    }
  });
});

console.log("=== Attachment Authorization Tests ===\n");

runTests().then(({ passed, failed }) => {
  console.log(`\nTotal: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}).catch(err => {
  console.error("Test runner error:", err);
  process.exit(1);
});
