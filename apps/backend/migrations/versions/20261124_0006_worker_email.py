"""worker email

Revision ID: 0006
Revises: 0005

Revision 0005 is taken by two other branches (first pay date, stub extras). When
they merge, re-point ``down_revision`` at whichever of them lands last.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("email", sa.String(length=254), nullable=False, server_default=""))


def downgrade() -> None:
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.drop_column("email")
