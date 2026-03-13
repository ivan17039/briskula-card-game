# GitHub Copilot Instructions

## Preferred AI Model

This repository is configured to use **Claude Sonnet 4.6** as the preferred AI model for GitHub Copilot Chat.

### Using Claude Sonnet 4.6 in VS Code

To use Claude Sonnet 4.6 in VS Code with GitHub Copilot:

1. **Install the GitHub Copilot and GitHub Copilot Chat extensions** in VS Code.
2. **Sign in** with a GitHub account that has an active Copilot subscription (Individual, Business, or Enterprise).
3. **Select the model** in the Copilot Chat panel:
   - Open the Copilot Chat panel (`Ctrl+Alt+I` / `Cmd+Alt+I`)
   - Click the model name at the top of the chat panel (e.g., "GPT-4o")
   - Select **Claude Sonnet 4.6** from the dropdown list

> **Note**: Claude Sonnet 4.6 availability depends on your Copilot subscription tier and your region. If it does not appear in the model list, ensure your subscription includes access to premium models.

The `.vscode/settings.json` file in this repository sets `github.copilot.chat.languageModel` to `claude-sonnet-4-6` so VS Code will default to that model automatically when the extension is installed and the model is available on your account.
