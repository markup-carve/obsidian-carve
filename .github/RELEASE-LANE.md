# Releasing

Prepare a version commit and an unpublished GitHub release with notes. Set the draft's tag to the repository's normal version format. Target it at the default branch to track the head while the version is prepared, or at the exact commit to release; either way the gates resolve it to one commit, and publishing rewrites the target to that commit.

Run the Release workflow from the default branch. Give the version number without a leading `v`, or leave it empty to release the version the commit already declares in `manifest.json`. Leave `publish` off for a rehearsal. It checks the commit's CI, prepared notes, builds and package validation without creating a remote tag or publishing anything.

To release, enable `publish`. After the same checks pass, approve the `release-approval` environment once. The workflow creates the tag at the checked commit, publishes packages and assets, verifies availability, then publishes the prepared notes. A failed check leaves the draft unpublished. Publication failures also produce a status report showing which packages and assets are available.

The Release workflow starts only by manual dispatch. Its reusable build jobs have no tag or public-release trigger. Publishing jobs verify that the current run has an approval and that the tag still points to the checked commit. Notes changed after the checks stop the release.

Repository administrators must configure `release-approval` with the required reviewer and default-branch policy. Existing package environments retain their secrets and trusted-publisher identities but must not require a second review. Restrict every package environment to the default branch before removing its reviewers. Apply that change only after the new workflow is merged. The rollout script checks the installed workflow before changing those settings.

Published package versions and tags cannot be moved or reused. A partial release needs an explicit recovery or a new version; rerunning a new-release lane does not overwrite it.
