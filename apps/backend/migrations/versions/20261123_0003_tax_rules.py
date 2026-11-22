"""tax rules

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tax_rules",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("jurisdiction", sa.String(length=12), nullable=False),
        sa.Column("tax", sa.String(length=20), nullable=False),
        sa.Column("method", sa.String(length=30), nullable=False),
        sa.Column("params", sa.JSON(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "jurisdiction", "tax"),
    )


def downgrade() -> None:
    op.drop_table("tax_rules")
