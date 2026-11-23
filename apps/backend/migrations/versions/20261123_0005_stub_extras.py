"""optional stub extras: paid time off, employer taxes, deposit slip

Revision ID: 0005_stub_extras
Revises: 0004
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_stub_extras"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("businesses", schema=None) as batch_op:
        for name in ("show_pto", "show_employer_taxes", "show_deposit_slip"):
            batch_op.add_column(sa.Column(name, sa.Boolean(), nullable=False, server_default="0"))
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pto_start", sa.JSON(), nullable=True))
    with op.batch_alter_table("stubs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("pto", sa.JSON(), nullable=True))
        batch_op.add_column(sa.Column("employer_taxes", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("stubs", schema=None) as batch_op:
        batch_op.drop_column("employer_taxes")
        batch_op.drop_column("pto")
    with op.batch_alter_table("workers", schema=None) as batch_op:
        batch_op.drop_column("pto_start")
    with op.batch_alter_table("businesses", schema=None) as batch_op:
        for name in ("show_deposit_slip", "show_employer_taxes", "show_pto"):
            batch_op.drop_column(name)
