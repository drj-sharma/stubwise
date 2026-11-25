"""worker Social Security number, last four digits only

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("ssn_last4", sa.String(length=4), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.drop_column("ssn_last4")
