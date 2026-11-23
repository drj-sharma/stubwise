"""first pay date on the business

Revision ID: 0005
Revises: 0004
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("businesses", schema=None) as batch_op:
        batch_op.add_column(sa.Column("first_pay_date", sa.String(length=10), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("businesses", schema=None) as batch_op:
        batch_op.drop_column("first_pay_date")
