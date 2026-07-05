# Contributing to SmartFill

Thanks for your interest in contributing!

## Reporting issues

Open a GitHub issue and include:

- The site/form where the problem occurred (URL if possible)
- What you expected to happen and what actually happened
- Browser and version

Please do not include personal data (names, emails, addresses) in issue reports.

## Development setup

No build step is required — this is a plain Manifest V3 extension.

1. Clone the repository
2. Open `chrome://extensions`, enable **Developer mode**, and **Load unpacked** the project folder
3. After editing files, click the reload icon on the extension card

## Pull requests

- Keep changes focused; one feature or fix per PR
- Match the existing code style (vanilla JavaScript, no frameworks, two-space indentation)
- The extension must remain fully local: no network calls, no analytics, no remote code
- Test on at least one real signup form before submitting

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
