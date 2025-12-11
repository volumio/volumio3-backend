# Contributing to Volumio

First off, thank you for considering contributing to Volumio. It's people like you that make Volumio such a great tool.

Following these guidelines helps to communicate that you respect the time of the developers managing and developing this project. In return, they should reciprocate that respect in addressing your issue, assessing changes, and helping you finalize your pull requests.

## How Can I Contribute?

### Getting Started

To get started with contributing to Volumio, follow these steps:

1. Prepare your development environment and ensure you have installed all the required packages listed in the README.md file
2. Fork this repository (if you're an external contributor)
3. Create a feature branch from `master` using the naming convention below

### Our Workflow

We keep things simple and effective. The `master` branch is our main branch where the source code always reflects a production-ready state. All contributions follow this workflow:

1. **Create a branch** from `master` using the naming convention below
2. **Make your changes** and commit them following our commit message format
3. **Test thoroughly** - testing is mandatory before submitting
4. **Open a Pull Request** to `master`
5. **Get approval** - one person with write access must review and approve your PR
6. **Merge** once approved and all checks pass

### Branch Protection

The `master` branch is protected and requires **1 approval** from a team member with write access before any PR can be merged.

### Branch Naming Convention

When starting work on a new feature or bug fix, create a new branch from `master`:

```bash
git checkout master
git pull origin master
git checkout -b feature/your-feature-name
```

Use one of these prefixes:

- `feature/your-feature-name` - New features
- `fix/issue-description` - Bug fixes
- `hotfix/critical-issue` - Urgent production fixes
- `refactor/what-you-refactored` - Code refactoring
- `docs/what-you-documented` - Documentation updates
- `build/build-changes` - Build system changes
- `perf/performance-improvement` - Performance improvements

**Examples:**
- `fix/dlna-discovery-race-condition`
- `hotfix/boot-failure-pi5`
- `docs/update-installation-guide`

### Pull Requests

#### Keep PRs Small and Focused

In order to streamline the review process and make it easier for maintainers to integrate your changes, we strongly prefer **small, focused pull requests**. This means:

- Each pull request should contain changes related to a **single feature or bug fix**
- Keep code changes **minimal and focused** on the specific issue
- If you have made multiple unrelated changes, please **split them into separate pull requests**
- Avoid mixing refactoring with feature work or bug fixes

Small PRs are:
- Easier to review
- Less likely to introduce bugs
- Faster to get merged
- Easier to revert if needed

**This makes maintainers' lives much easier and your contributions will be appreciated even more!**

#### Include Test Reports

**Test reports will get your PR merged faster!** When you submit your pull request, include details about how you tested your changes:

- What hardware/configuration you tested on
- Steps you took to verify the fix/feature works
- Any edge cases you tested
- Screenshots or logs if applicable

Example:
```
Tested on:
- Raspberry Pi 4 with HiFiBerry DAC
- Volumio 3.5
- Verified DLNA discovery works after network reconnect
- Tested with both WiFi and Ethernet
```

#### Before Submitting

Please ensure:

1. Your commits follow the commit message format (see below)
2. You've tested your changes thoroughly with a full build
3. You've included a test report in your PR description

## Commit Message Format

All commits must follow semantic commit format.

### Format

```
type: description
```

### Allowed Types

| Type       | Description                                      |
|------------|--------------------------------------------------|
| fix        | Bug fixes                                        |
| feat       | New features                                     |
| docs       | Documentation changes                            |
| chore      | Maintenance, dependencies, cleanup               |
| refactor   | Code restructuring without behavior change       |
| test       | Adding or updating tests                         |
| build      | Build system, recipes, makefiles                 |
| ci         | CI/CD configuration                              |
| perf       | Performance improvements                         |
| revert     | Reverting previous commits                       |
| hotfix     | Critical production fixes                        |

### Examples

```
fix: resolve plymouth rotation on SPI displays
feat: add support for Waveshare 3.5" display
docs: update installation instructions
refactor: simplify module loading sequence
build: update kernel version for pi recipe
perf: reduce SPI display detection time
hotfix: critical boot failure on Pi 5
```

### Shell Scripts

Shell scripts are automatically checked by `shellcheck` and `shfmt`. Ensure your scripts pass these checks before submitting.

Run locally:
```bash
shellcheck your-script.sh
shfmt -l your-script.sh
```

## Community

You can chat with the core team and other contributors on [our community forums](https://community.volumio.com/).

## Questions?

If you have questions about the contribution process, please open an issue or ask in the community forums. We're here to help!

## Intellectual Property

By contributing to this project, you agree to assign all intellectual property rights of your contribution to **Volumio SRL**. This includes, but is not limited to, any code, documentation, designs, or other materials you submit via pull requests, issues, or any other means.
This assignment allows Volumio SRL to maintain, distribute, and license the project effectively while ensuring the project can continue to grow and evolve.
If you have any questions or concerns about this policy, please contact us before submitting your contribution.


Thank you for contributing to Volumio!
