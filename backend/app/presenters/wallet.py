"""PRESENTER: payment & wallet (double-entry style ledger of signed transactions)."""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import providers
from app.models.entities import WalletTxn
from app.models.repositories import UserRepository, WalletRepository
from app.presenters.base import AppError, not_found


def txn_view(t: WalletTxn) -> dict:
    return {"id": t.id, "amount_paise": t.amount_paise, "balance_after": t.balance_after, "kind": t.kind,
            "ref": t.ref, "created_at": t.created_at.isoformat()}


class WalletPresenter:
    def __init__(self, db: Session):
        self.db = db
        self.users = UserRepository(db)
        self.repo = WalletRepository(db)

    def post(self, user_id: str, amount_paise: int, kind: str, ref: str | None = None,
             idem: str | None = None, allow_negative: bool = False) -> WalletTxn:
        """Atomically apply a signed amount to a wallet (row-locked)."""
        u = self.users.get_for_update(user_id)
        if not u:
            raise not_found("User")
        if u.wallet_paise + amount_paise < 0 and not allow_negative:
            raise AppError(402, "insufficient_balance", "Insufficient wallet balance")
        u.wallet_paise += amount_paise
        return self.repo.add(WalletTxn(user_id=user_id, amount_paise=amount_paise, balance_after=u.wallet_paise,
                                       kind=kind, ref=ref, idempotency_key=idem))

    def balance(self, user_id: str) -> dict:
        u = self.users.get(user_id)
        if not u:
            raise not_found("User")
        return {"balance_paise": u.wallet_paise, "currency": "INR"}

    def topup(self, user_id: str, amount_paise: int, idem: str | None) -> dict:
        if not (10000 <= amount_paise <= 1000000):
            raise AppError(422, "invalid_amount", "Top-up must be between ₹100 and ₹10,000")
        if idem:
            prior = self.repo.txn_by_idem(user_id, idem)
            if prior:
                return {"transaction": txn_view(prior), "balance_paise": prior.balance_after, "replayed": True}
        ok, ref = providers.gateway().charge(user_id, amount_paise, "upi")
        if not ok:
            raise AppError(402, "payment_failed", "Payment was declined by the gateway")
        try:
            t = self.post(user_id, amount_paise, "topup", ref=ref, idem=idem)
            self.db.flush()
        except IntegrityError:
            self.db.rollback()
            prior = self.repo.txn_by_idem(user_id, idem or "")
            return {"transaction": txn_view(prior), "balance_paise": prior.balance_after, "replayed": True}
        return {"transaction": txn_view(t), "balance_paise": t.balance_after, "replayed": False}

    def transactions(self, user_id: str) -> dict:
        return {"items": [txn_view(t) for t in self.repo.list(user_id)]}
