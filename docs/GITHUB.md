# GitHub repository handoff

Target GitHub user: `CavinHuang`
Target name: `content-studio`
Suggested visibility: **Private** (until source terms, security model and secret handling are reviewed).

The GitHub connector used here supports reading repos and writing files/commits to existing repositories, but **does not expose Create Repository**. This prevents automatic creation of a new remote from this conversation. The prepared Git repository contains `main` and an initial commit; no remote has been pushed.

1. Open https://github.com/new?name=content-studio and choose Private. Do not initialize with GitHub README or license.
2. In extracted git checkout, run:

```bash
git remote add origin https://github.com/CavinHuang/content-studio.git
git push -u origin main
```

For the downloadable `.git.bundle` instead:

```bash
git clone content-studio-nextjs.git.bundle content-studio
cd content-studio
git remote add origin https://github.com/CavinHuang/content-studio.git
git push -u origin main
```

3. In a networked environment run `npm install` then commit generated `package-lock.json` and switch the GitHub Actions workflow to `npm ci`.
4. Configure GitHub branch protection for `main` and require `test-and-build` checks. No secret API keys in repo.
