export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  line?: number;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Bot stderr captured during smoke run (if any). */
  stderr?: string;
}

export interface Validator {
  /** Static AST checks + smoke run. Returns ok=true if the bot is safe to enroll. */
  validate(code: string): Promise<ValidationResult>;
}
