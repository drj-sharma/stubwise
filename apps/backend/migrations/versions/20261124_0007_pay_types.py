"""per-unit pay and supplemental pay on stub lines

Revision ID: 0007
Revises: 0006
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # All nullable: stubs saved before this keep loading exactly as they were.
    op.add_column("stub_lines", sa.Column("quantity_milli", sa.BigInteger(), nullable=True))
    op.add_column("stub_lines", sa.Column("unit", sa.String(length=12), nullable=True))
    op.add_column("stub_lines", sa.Column("supplemental", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("stub_lines", "supplemental")
    op.drop_column("stub_lines", "unit")
    op.drop_column("stub_lines", "quantity_milli")
