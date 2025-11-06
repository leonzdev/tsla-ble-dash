# Skills & Handy Commands

## GitHub CLI (gh)

- View one PR's exact state (open/closed), draft, merged, mergeability, and review status:

```
gh pr view <PR_NUMBER> \
  --json state,isDraft,mergedAt,mergeStateStatus,reviewDecision,url \
  --jq '{state,draft:.isDraft,merged:(.mergedAt!=null),mergeState:.mergeStateStatus,review:.reviewDecision,url}'
```

- List PRs with state and draft flag:

```
gh pr list --state all -L 20 \
  --json number,title,state,isDraft \
  --jq '.[] | {number,title,state,draft:.isDraft}'
```

- Current branch PR status:

```
gh pr status
```

- Target a specific repository:

```
# add -R owner/repo to any gh command
gh pr view -R <owner>/<repo> <PR_NUMBER> --json state,isDraft,mergedAt
```
