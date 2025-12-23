"""
GitHub Automation Data Models
=============================

Data structures for GitHub automation features.
Stored in .auto-claude/github/pr/ and .auto-claude/github/issues/
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path


class ReviewSeverity(str, Enum):
    """Severity levels for PR review findings."""

    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ReviewCategory(str, Enum):
    """Categories for PR review findings."""

    SECURITY = "security"
    QUALITY = "quality"
    STYLE = "style"
    TEST = "test"
    DOCS = "docs"
    PATTERN = "pattern"
    PERFORMANCE = "performance"


class TriageCategory(str, Enum):
    """Issue triage categories."""

    BUG = "bug"
    FEATURE = "feature"
    DOCUMENTATION = "documentation"
    QUESTION = "question"
    DUPLICATE = "duplicate"
    SPAM = "spam"
    FEATURE_CREEP = "feature_creep"


class AutoFixStatus(str, Enum):
    """Status for auto-fix operations."""

    PENDING = "pending"
    ANALYZING = "analyzing"
    CREATING_SPEC = "creating_spec"
    BUILDING = "building"
    QA_REVIEW = "qa_review"
    PR_CREATED = "pr_created"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class PRReviewFinding:
    """A single finding from a PR review."""

    id: str
    severity: ReviewSeverity
    category: ReviewCategory
    title: str
    description: str
    file: str
    line: int
    end_line: int | None = None
    suggested_fix: str | None = None
    fixable: bool = False

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "severity": self.severity.value,
            "category": self.category.value,
            "title": self.title,
            "description": self.description,
            "file": self.file,
            "line": self.line,
            "end_line": self.end_line,
            "suggested_fix": self.suggested_fix,
            "fixable": self.fixable,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PRReviewFinding:
        return cls(
            id=data["id"],
            severity=ReviewSeverity(data["severity"]),
            category=ReviewCategory(data["category"]),
            title=data["title"],
            description=data["description"],
            file=data["file"],
            line=data["line"],
            end_line=data.get("end_line"),
            suggested_fix=data.get("suggested_fix"),
            fixable=data.get("fixable", False),
        )


@dataclass
class PRReviewResult:
    """Complete result of a PR review."""

    pr_number: int
    repo: str
    success: bool
    findings: list[PRReviewFinding] = field(default_factory=list)
    summary: str = ""
    overall_status: str = "comment"  # approve, request_changes, comment
    review_id: int | None = None
    reviewed_at: str = field(default_factory=lambda: datetime.now().isoformat())
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "pr_number": self.pr_number,
            "repo": self.repo,
            "success": self.success,
            "findings": [f.to_dict() for f in self.findings],
            "summary": self.summary,
            "overall_status": self.overall_status,
            "review_id": self.review_id,
            "reviewed_at": self.reviewed_at,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, data: dict) -> PRReviewResult:
        return cls(
            pr_number=data["pr_number"],
            repo=data["repo"],
            success=data["success"],
            findings=[PRReviewFinding.from_dict(f) for f in data.get("findings", [])],
            summary=data.get("summary", ""),
            overall_status=data.get("overall_status", "comment"),
            review_id=data.get("review_id"),
            reviewed_at=data.get("reviewed_at", datetime.now().isoformat()),
            error=data.get("error"),
        )

    def save(self, github_dir: Path) -> None:
        """Save review result to .auto-claude/github/pr/"""
        pr_dir = github_dir / "pr"
        pr_dir.mkdir(parents=True, exist_ok=True)

        review_file = pr_dir / f"review_{self.pr_number}.json"
        with open(review_file, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

        # Update index
        self._update_index(pr_dir)

    def _update_index(self, pr_dir: Path) -> None:
        """Update the PR review index."""
        index_file = pr_dir / "index.json"

        if index_file.exists():
            with open(index_file) as f:
                index = json.load(f)
        else:
            index = {"reviews": [], "last_updated": None}

        # Update or add entry
        reviews = index.get("reviews", [])
        existing = next((r for r in reviews if r["pr_number"] == self.pr_number), None)

        entry = {
            "pr_number": self.pr_number,
            "repo": self.repo,
            "overall_status": self.overall_status,
            "findings_count": len(self.findings),
            "reviewed_at": self.reviewed_at,
        }

        if existing:
            reviews = [
                entry if r["pr_number"] == self.pr_number else r for r in reviews
            ]
        else:
            reviews.append(entry)

        index["reviews"] = reviews
        index["last_updated"] = datetime.now().isoformat()

        with open(index_file, "w") as f:
            json.dump(index, f, indent=2)

    @classmethod
    def load(cls, github_dir: Path, pr_number: int) -> PRReviewResult | None:
        """Load a review result from disk."""
        review_file = github_dir / "pr" / f"review_{pr_number}.json"
        if not review_file.exists():
            return None

        with open(review_file) as f:
            return cls.from_dict(json.load(f))


@dataclass
class TriageResult:
    """Result of triaging a single issue."""

    issue_number: int
    repo: str
    category: TriageCategory
    confidence: float  # 0.0 to 1.0
    labels_to_add: list[str] = field(default_factory=list)
    labels_to_remove: list[str] = field(default_factory=list)
    is_duplicate: bool = False
    duplicate_of: int | None = None
    is_spam: bool = False
    is_feature_creep: bool = False
    suggested_breakdown: list[str] = field(default_factory=list)
    priority: str = "medium"  # high, medium, low
    comment: str | None = None
    triaged_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> dict:
        return {
            "issue_number": self.issue_number,
            "repo": self.repo,
            "category": self.category.value,
            "confidence": self.confidence,
            "labels_to_add": self.labels_to_add,
            "labels_to_remove": self.labels_to_remove,
            "is_duplicate": self.is_duplicate,
            "duplicate_of": self.duplicate_of,
            "is_spam": self.is_spam,
            "is_feature_creep": self.is_feature_creep,
            "suggested_breakdown": self.suggested_breakdown,
            "priority": self.priority,
            "comment": self.comment,
            "triaged_at": self.triaged_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> TriageResult:
        return cls(
            issue_number=data["issue_number"],
            repo=data["repo"],
            category=TriageCategory(data["category"]),
            confidence=data["confidence"],
            labels_to_add=data.get("labels_to_add", []),
            labels_to_remove=data.get("labels_to_remove", []),
            is_duplicate=data.get("is_duplicate", False),
            duplicate_of=data.get("duplicate_of"),
            is_spam=data.get("is_spam", False),
            is_feature_creep=data.get("is_feature_creep", False),
            suggested_breakdown=data.get("suggested_breakdown", []),
            priority=data.get("priority", "medium"),
            comment=data.get("comment"),
            triaged_at=data.get("triaged_at", datetime.now().isoformat()),
        )

    def save(self, github_dir: Path) -> None:
        """Save triage result to .auto-claude/github/issues/"""
        issues_dir = github_dir / "issues"
        issues_dir.mkdir(parents=True, exist_ok=True)

        triage_file = issues_dir / f"triage_{self.issue_number}.json"
        with open(triage_file, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

    @classmethod
    def load(cls, github_dir: Path, issue_number: int) -> TriageResult | None:
        """Load a triage result from disk."""
        triage_file = github_dir / "issues" / f"triage_{issue_number}.json"
        if not triage_file.exists():
            return None

        with open(triage_file) as f:
            return cls.from_dict(json.load(f))


@dataclass
class AutoFixState:
    """State tracking for auto-fix operations."""

    issue_number: int
    issue_url: str
    repo: str
    status: AutoFixStatus = AutoFixStatus.PENDING
    spec_id: str | None = None
    spec_dir: str | None = None
    pr_number: int | None = None
    pr_url: str | None = None
    bot_comments: list[str] = field(default_factory=list)
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    def to_dict(self) -> dict:
        return {
            "issue_number": self.issue_number,
            "issue_url": self.issue_url,
            "repo": self.repo,
            "status": self.status.value,
            "spec_id": self.spec_id,
            "spec_dir": self.spec_dir,
            "pr_number": self.pr_number,
            "pr_url": self.pr_url,
            "bot_comments": self.bot_comments,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: dict) -> AutoFixState:
        return cls(
            issue_number=data["issue_number"],
            issue_url=data["issue_url"],
            repo=data["repo"],
            status=AutoFixStatus(data.get("status", "pending")),
            spec_id=data.get("spec_id"),
            spec_dir=data.get("spec_dir"),
            pr_number=data.get("pr_number"),
            pr_url=data.get("pr_url"),
            bot_comments=data.get("bot_comments", []),
            error=data.get("error"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
        )

    def update_status(self, status: AutoFixStatus) -> None:
        """Update status and timestamp."""
        self.status = status
        self.updated_at = datetime.now().isoformat()

    def save(self, github_dir: Path) -> None:
        """Save auto-fix state to .auto-claude/github/issues/"""
        issues_dir = github_dir / "issues"
        issues_dir.mkdir(parents=True, exist_ok=True)

        autofix_file = issues_dir / f"autofix_{self.issue_number}.json"
        with open(autofix_file, "w") as f:
            json.dump(self.to_dict(), f, indent=2)

        # Update index
        self._update_index(issues_dir)

    def _update_index(self, issues_dir: Path) -> None:
        """Update the issues index with auto-fix queue."""
        index_file = issues_dir / "index.json"

        if index_file.exists():
            with open(index_file) as f:
                index = json.load(f)
        else:
            index = {"triaged": [], "auto_fix_queue": [], "last_updated": None}

        # Update auto-fix queue
        queue = index.get("auto_fix_queue", [])
        existing = next(
            (q for q in queue if q["issue_number"] == self.issue_number), None
        )

        entry = {
            "issue_number": self.issue_number,
            "repo": self.repo,
            "status": self.status.value,
            "spec_id": self.spec_id,
            "pr_number": self.pr_number,
            "updated_at": self.updated_at,
        }

        if existing:
            queue = [
                entry if q["issue_number"] == self.issue_number else q for q in queue
            ]
        else:
            queue.append(entry)

        index["auto_fix_queue"] = queue
        index["last_updated"] = datetime.now().isoformat()

        with open(index_file, "w") as f:
            json.dump(index, f, indent=2)

    @classmethod
    def load(cls, github_dir: Path, issue_number: int) -> AutoFixState | None:
        """Load an auto-fix state from disk."""
        autofix_file = github_dir / "issues" / f"autofix_{issue_number}.json"
        if not autofix_file.exists():
            return None

        with open(autofix_file) as f:
            return cls.from_dict(json.load(f))


@dataclass
class GitHubRunnerConfig:
    """Configuration for GitHub automation runners."""

    # Authentication
    token: str
    repo: str  # owner/repo format
    bot_token: str | None = None  # Separate bot account token

    # Auto-fix settings
    auto_fix_enabled: bool = False
    auto_fix_labels: list[str] = field(default_factory=lambda: ["auto-fix"])
    require_human_approval: bool = True

    # Triage settings
    triage_enabled: bool = False
    duplicate_threshold: float = 0.80
    spam_threshold: float = 0.75
    feature_creep_threshold: float = 0.70
    enable_triage_comments: bool = False

    # PR review settings
    pr_review_enabled: bool = False
    auto_post_reviews: bool = False
    allow_fix_commits: bool = True

    # Model settings
    model: str = "claude-sonnet-4-20250514"
    thinking_level: str = "medium"

    def to_dict(self) -> dict:
        return {
            "token": "***",  # Never save token
            "repo": self.repo,
            "bot_token": "***" if self.bot_token else None,
            "auto_fix_enabled": self.auto_fix_enabled,
            "auto_fix_labels": self.auto_fix_labels,
            "require_human_approval": self.require_human_approval,
            "triage_enabled": self.triage_enabled,
            "duplicate_threshold": self.duplicate_threshold,
            "spam_threshold": self.spam_threshold,
            "feature_creep_threshold": self.feature_creep_threshold,
            "enable_triage_comments": self.enable_triage_comments,
            "pr_review_enabled": self.pr_review_enabled,
            "auto_post_reviews": self.auto_post_reviews,
            "allow_fix_commits": self.allow_fix_commits,
            "model": self.model,
            "thinking_level": self.thinking_level,
        }

    def save_settings(self, github_dir: Path) -> None:
        """Save non-sensitive settings to config.json."""
        github_dir.mkdir(parents=True, exist_ok=True)
        config_file = github_dir / "config.json"

        # Save without tokens
        settings = self.to_dict()
        settings.pop("token", None)
        settings.pop("bot_token", None)

        with open(config_file, "w") as f:
            json.dump(settings, f, indent=2)

    @classmethod
    def load_settings(
        cls, github_dir: Path, token: str, repo: str, bot_token: str | None = None
    ) -> GitHubRunnerConfig:
        """Load settings from config.json, with tokens provided separately."""
        config_file = github_dir / "config.json"

        if config_file.exists():
            with open(config_file) as f:
                settings = json.load(f)
        else:
            settings = {}

        return cls(
            token=token,
            repo=repo,
            bot_token=bot_token,
            auto_fix_enabled=settings.get("auto_fix_enabled", False),
            auto_fix_labels=settings.get("auto_fix_labels", ["auto-fix"]),
            require_human_approval=settings.get("require_human_approval", True),
            triage_enabled=settings.get("triage_enabled", False),
            duplicate_threshold=settings.get("duplicate_threshold", 0.80),
            spam_threshold=settings.get("spam_threshold", 0.75),
            feature_creep_threshold=settings.get("feature_creep_threshold", 0.70),
            enable_triage_comments=settings.get("enable_triage_comments", False),
            pr_review_enabled=settings.get("pr_review_enabled", False),
            auto_post_reviews=settings.get("auto_post_reviews", False),
            allow_fix_commits=settings.get("allow_fix_commits", True),
            model=settings.get("model", "claude-sonnet-4-20250514"),
            thinking_level=settings.get("thinking_level", "medium"),
        )
