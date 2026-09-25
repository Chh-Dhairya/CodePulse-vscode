import * as vscode from "vscode";

/**
 * Stores the CodePulse API key in VS Code's `SecretStorage` -- never in
 * a plain settings file (`settings.json`/`.vscode/settings.json`),
 * which would put the raw key in a file a user might commit or sync
 * unencrypted. This is the same "never persist the raw key anywhere
 * else" discipline the CodePulse server itself applies (only a
 * SHA-256 hash is ever stored server-side); here it's "never persist
 * the raw key anywhere a plain-text settings file would."
 */
const SECRET_KEY = "codepulse.apiKey";

export class AuthManager {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getApiKey(): Promise<string | undefined> {
    return this.secrets.get(SECRET_KEY);
  }

  async setApiKeyInteractive(): Promise<boolean> {
    const value = await vscode.window.showInputBox({
      title: "CodePulse API Key",
      prompt: "Enter a CodePulse API key (starts with cpk_). Create one with `codepulse` CLI or the /v1/admin/keys endpoint.",
      password: true,
      ignoreFocusOut: true,
      validateInput: (v) => (v && v.trim().length > 0 ? undefined : "API key cannot be empty"),
    });
    if (!value) {
      return false;
    }
    await this.secrets.store(SECRET_KEY, value.trim());
    vscode.window.showInformationMessage("CodePulse API key saved.");
    return true;
  }

  async clearApiKey(): Promise<void> {
    await this.secrets.delete(SECRET_KEY);
  }
}
