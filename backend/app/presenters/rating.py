"""PRESENTER: ratings & feedback (both directions)."""
from sqlalchemy.orm import Session

from app.models.entities import Rating
from app.models.repositories import RatingRepository, RideRepository, UserRepository
from app.presenters.base import AppError, EventView, forbidden, not_found
from app.presenters.notifications import NotificationPresenter


class RatingPresenter:
    def __init__(self, db: Session, events: EventView):
        self.db = db
        self.repo = RatingRepository(db)
        self.rides = RideRepository(db)
        self.users = UserRepository(db)
        self.notify = NotificationPresenter(db, events)

    def rate(self, user_id: str, ride_id: str, stars: int, tags: list[str], comment: str) -> dict:
        ride = self.rides.get(ride_id)
        if not ride:
            raise not_found("Ride")
        if user_id not in (ride.rider_id, ride.driver_id):
            raise forbidden()
        if ride.status != "COMPLETED":
            raise AppError(409, "not_completed", "You can rate only completed rides")
        if not 1 <= stars <= 5:
            raise AppError(422, "invalid_rating", "Rating must be between 1 and 5")
        if self.repo.exists(ride_id, user_id):
            raise AppError(409, "already_rated", "You already rated this ride")
        target_id = ride.driver_id if user_id == ride.rider_id else ride.rider_id
        self.repo.add(Rating(ride_id=ride_id, from_user_id=user_id, to_user_id=target_id, stars=stars,
                             tags=tags[:6], comment=comment[:500]))
        target = self.users.get_for_update(target_id)
        total = target.rating_avg * target.rating_count + stars
        target.rating_count += 1
        target.rating_avg = round(total / target.rating_count, 4)
        self.notify.notify(target_id, "New rating", f"You received {stars}★ for a recent trip.", "rating.received",
                           {"ride_id": ride_id, "stars": stars})
        return {"ok": True, "target_rating_avg": round(target.rating_avg, 2)}

    def for_ride(self, user_id: str, ride_id: str) -> dict:
        ride = self.rides.get(ride_id)
        if not ride or user_id not in (ride.rider_id, ride.driver_id):
            raise not_found("Ride")
        return {"items": [{"from": r.from_user_id, "to": r.to_user_id, "stars": r.stars, "tags": r.tags,
                           "comment": r.comment} for r in self.repo.for_ride(ride_id)]}

    def received(self, user_id: str) -> dict:
        u = self.users.get(user_id)
        return {"average": round(u.rating_avg, 2), "count": u.rating_count,
                "items": [{"stars": r.stars, "tags": r.tags, "comment": r.comment,
                           "created_at": r.created_at.isoformat()} for r in self.repo.received(user_id)]}
