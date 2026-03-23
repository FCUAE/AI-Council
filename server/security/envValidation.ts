const isProduction = process.env.NODE_ENV === "production";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function validateAdminUserIds(): { valid: boolean; error?: string } {
  const raw = process.env.ADMIN_USER_IDS;
  if (!raw) {
    return { valid: true };
  }
  const ids = raw.split(",").map((id) => id.trim());
  for (const id of ids) {
    if (id.length === 0) {
      return {
        valid: false,
        error:
          "ADMIN_USER_IDS contains empty entries (check for trailing commas)",
      };
    }
  }
  return { valid: true };
}

export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!process.env.DATABASE_URL) {
    errors.push("DATABASE_URL is not set");
  }

  if (isProduction) {
    if (!process.env.CLERK_PROD_SECRET_KEY) {
      errors.push(
        "CLERK_PROD_SECRET_KEY is required in production",
      );
    }
    if (!process.env.CLERK_PROD_PUBLISHABLE_KEY) {
      errors.push(
        "CLERK_PROD_PUBLISHABLE_KEY is required in production",
      );
    }
  } else {
    if (
      !process.env.CLERK_SECRET_KEY &&
      !process.env.CLERK_PROD_SECRET_KEY
    ) {
      warnings.push(
        "No Clerk secret key set (CLERK_SECRET_KEY or CLERK_PROD_SECRET_KEY)",
      );
    }
    if (
      !process.env.CLERK_PUBLISHABLE_KEY &&
      !process.env.CLERK_PROD_PUBLISHABLE_KEY
    ) {
      warnings.push(
        "No Clerk publishable key set (CLERK_PUBLISHABLE_KEY or CLERK_PROD_PUBLISHABLE_KEY)",
      );
    }
  }

  if (
    !process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY
  ) {
    errors.push(
      "AI_INTEGRATIONS_OPENROUTER_API_KEY is required",
    );
  }

  const adminResult = validateAdminUserIds();
  if (!adminResult.valid) {
    errors.push(adminResult.error!);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

export function runStartupValidation(): void {
  const result = validateEnvironment();

  for (const warning of result.warnings) {
    console.warn(`[ENV] WARNING: ${warning}`);
  }

  if (!result.valid) {
    for (const error of result.errors) {
      console.error(`[ENV] ERROR: ${error}`);
    }
    console.error(
      "[ENV] Startup aborted due to missing or malformed environment variables",
    );
    process.exit(1);
  }

  console.log("[ENV] Environment validation passed");
}
