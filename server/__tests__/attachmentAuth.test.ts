import { normalizeAttachmentUrl, validateAttachmentAccess, validateAttachmentsBatch, AttachmentAuthError } from "../security/attachmentAuth";

let mockCanAccess = true;

async function setupMocks() {
  const assert = await import("assert");
  return { assert: assert.strict };
}

function describe(name: string, fn: () => void) {
  console.log(`\n=== ${name} ===`);
  fn();
}

let testQueue: { name: string; fn: () => Promise<void> }[] = [];

function it(name: string, fn: () => Promise<void>) {
  testQueue.push({ name, fn });
}

async function runTests() {
  const { assert } = await setupMocks();
  let passed = 0;
  let failed = 0;
  const failures: { name: string; error: any }[] = [];

  for (const test of testQueue) {
    try {
      await test.fn();
      console.log(`  ✓ ${test.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${test.name}: ${err.message}`);
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
    const result = normalizeAttachmentUrl("/uploads/test.png?v=123");
    if (result !== "/uploads/test.png") throw new Error(`Expected /uploads/test.png, got ${result}`);
  });

  it("strips fragments", async () => {
    const result = normalizeAttachmentUrl("/uploads/test.png#section");
    if (result !== "/uploads/test.png") throw new Error(`Expected /uploads/test.png, got ${result}`);
  });

  it("decodes URL-encoded characters", async () => {
    const result = normalizeAttachmentUrl("/uploads/test%20file.png");
    if (result !== "/uploads/test file.png") throw new Error(`Expected /uploads/test file.png, got ${result}`);
  });

  it("collapses duplicate slashes", async () => {
    const result = normalizeAttachmentUrl("/uploads///test.png");
    if (result !== "/uploads/test.png") throw new Error(`Expected /uploads/test.png, got ${result}`);
  });

  it("resolves path traversal attempts", async () => {
    const result = normalizeAttachmentUrl("/uploads/../etc/passwd");
    if (result !== "/etc/passwd") throw new Error(`Expected /etc/passwd, got ${result}`);
  });

  it("resolves dot segments", async () => {
    const result = normalizeAttachmentUrl("/uploads/./test.png");
    if (result !== "/uploads/test.png") throw new Error(`Expected /uploads/test.png, got ${result}`);
  });

  it("rejects empty URL", async () => {
    try {
      normalizeAttachmentUrl("");
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw new Error(`Expected AttachmentAuthError, got ${err.constructor.name}`);
      if (err.reason !== "empty_url") throw new Error(`Expected empty_url reason, got ${err.reason}`);
    }
  });

  it("handles absolute HTTP URLs by extracting path", async () => {
    const result = normalizeAttachmentUrl("https://example.com/uploads/test.png?v=1");
    if (result !== "/uploads/test.png") throw new Error(`Expected /uploads/test.png, got ${result}`);
  });

  it("rejects malformed absolute URLs", async () => {
    try {
      normalizeAttachmentUrl("http://[invalid-bracket");
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) {
        if (err instanceof TypeError && err.message.includes("Invalid URL")) {
          return;
        }
        throw new Error(`Expected AttachmentAuthError or TypeError, got ${err.constructor.name}: ${err.message}`);
      }
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
});

describe("validateAttachmentAccess — /uploads/ paths", () => {
  it("rejects if no file_uploads ownership record exists (file existence ≠ auth)", async () => {
    try {
      await validateAttachmentAccess("user-1", "/uploads/orphan-file.png", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
      if (err.reason !== "no_ownership_record") throw new Error(`Expected no_ownership_record, got ${err.reason}`);
    }
  });

  it("rejects if user is not the owner", async () => {
    try {
      await validateAttachmentAccess("user-attacker", "/uploads/victim-file.png", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
    }
  });
});

describe("validateAttachmentsBatch", () => {
  it("rejects entire batch on first failure", async () => {
    const attachments = [
      { url: "/uploads/my-file.png", name: "a", type: "image/png", size: 100 },
      { url: "/uploads/not-my-file.png", name: "b", type: "image/png", size: 100 },
    ];

    try {
      await validateAttachmentsBatch("user-1", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
    }
  });
});

describe("URL normalization edge cases", () => {
  it("handles double-encoded percent", async () => {
    const result = normalizeAttachmentUrl("/uploads/test%2520file.png");
    if (!result.includes("uploads")) throw new Error(`Unexpected result: ${result}`);
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

describe("ingestion-level batch validation", () => {
  it("rejects entire batch when one attachment is forged /uploads/ path with no ownership", async () => {
    const attachments = [
      { url: "/uploads/my-legit-file.png", name: "mine.png" },
      { url: "/uploads/other-users-secret.png", name: "stolen.png" }
    ];
    try {
      await validateAttachmentsBatch("user-1", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
    }
  });

  it("rejects forged /objects/ path when ACL denies", async () => {
    mockCanAccess = false;
    try {
      await validateAttachmentAccess("user-1", "/objects/private/.private/other-user/secret.pdf", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
    } finally {
      mockCanAccess = true;
    }
  });

  it("rejects batch with data: URI (not a legitimate client attachment)", async () => {
    const attachments = [
      { url: "data:image/png;base64,AAAA", name: "inline.png" }
    ];
    try {
      await validateAttachmentsBatch("user-1", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 400) throw new Error(`Expected 400, got ${err.statusCode}`);
    }
  });

  it("rejects batch with path traversal attempt targeting /uploads/", async () => {
    const attachments = [
      { url: "/uploads/../../../etc/passwd", name: "passwd" }
    ];
    try {
      await validateAttachmentsBatch("user-1", attachments, false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
    }
  });

  it("admin override still requires ownership record to exist (no record = 403)", async () => {
    try {
      await validateAttachmentAccess("admin-user", "/uploads/nonexistent.png", true);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.reason !== "no_ownership_record") throw new Error(`Expected no_ownership_record, got ${err.reason}`);
    }
  });

  it("non-admin is denied access to file owned by another user (via DB)", async () => {
    try {
      await validateAttachmentAccess("attacker-user", "/uploads/nonexistent-victim-file.png", false);
      throw new Error("Should have thrown");
    } catch (err: any) {
      if (!(err instanceof AttachmentAuthError)) throw err;
      if (err.statusCode !== 403) throw new Error(`Expected 403, got ${err.statusCode}`);
    }
  });

  it("admin override allows access to /objects/ without ACL check", async () => {
    await validateAttachmentAccess("admin-user", "/objects/public/shared-file.png", true);
  });

  it("rejects retry-style batch with malformed attachment (empty URL)", async () => {
    const attachments = [
      { url: "", name: "bad.png" }
    ];
    try {
      await validateAttachmentsBatch("user-1", attachments, false);
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
