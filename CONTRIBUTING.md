# Contributing to Nextellar

Thank you for considering contributing! We welcome contributions of any size. To get started, please follow these steps:

## 1. Fork the Repository
1. Click the “Fork” button at the top right of the repo.
2. Clone your fork:
   ```bash
   git clone git@github.com:<your-username>/nextellar.git
   cd nextellar
   ```

## 2. Set Up Your Development Environment
1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the project:
   ```bash
   npm run build
   ```
3. (Optional) Install globally for testing:
   ```bash
   npm link
   ```

## 3. Create a Branch
Use descriptive branch names, prefixed by type:
- `feature/<short-description>`
- `bugfix/<short-description>`
- `docs/<short-description>`

Example:
```bash
git checkout -b feature/cli-flags
```

## 4. Make Your Changes
- Follow the existing code style (TypeScript, ESLint, Prettier).
- Write tests for new functionality.
- Update or add documentation (README, docs site, etc.).

## 5. Run Tests and Linters
```bash
npm run lint
npm test
npm run build
```
Ensure all checks pass before submitting.

## 6. Commit and Push
- Write clear, concise commit messages.
- Push your branch:
  ```bash
  git push origin feature/cli-flags
  ```

## 7. Open a Pull Request
1. In your fork, click “Compare & pull request.”
2. Fill out the PR template with details of your changes.
3. Request review from the maintainers: @Ebubechi and @DavidDumtochukwu.

## 8. Code Review & Merge
- Address any feedback.
- Once approved, your PR will be merged and you’ll be credited as a contributor!

## 9. Finding Product Issues to Contribute To

When looking for issues to work on, use GitHub's labeling system to filter for suitable tasks. Common labels include:

- `good first issue` – Ideal for newcomers to the project.
- `help wanted` – Issues that need additional assistance.
- `product` – Issues related to product features or improvements.

You can filter issues directly on GitHub:

```text
is:issue is:open label:"good first issue"
```

or use the UI:
1. Navigate to the **Issues** tab of the Nextellar repository.
2. Click **Labels** and select the desired label(s).
3. Review the filtered list and pick an issue that matches your interests and skill set.

Make sure to read the issue description and any associated discussion before starting work.

---

Thank you for helping make Nextellar better! 🎉
