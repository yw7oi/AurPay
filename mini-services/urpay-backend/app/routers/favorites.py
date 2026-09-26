"""Favorites — quick-transfer contacts."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Favorite, User
from ..security import get_current_user

router = APIRouter(prefix="/api", tags=["favorites"])


def _fav_dict(fav: Favorite, target: User) -> dict:
    return {
        "id": fav.id,
        "user_id": target.id,
        "full_name": target.full_name,
        "first_name": target.first_name,
        "city": target.city,
        "card_number": target.card_number,
        "avatar_hue": target.avatar_hue,
    }


@router.get("/favorites")
async def list_favorites(user: User = Depends(get_current_user),
                         session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(
        select(Favorite, User)
        .join(User, Favorite.target_user_id == User.id)
        .where(Favorite.user_id == user.id)
        .order_by(Favorite.created_at.desc()))).all()
    return [_fav_dict(fav, target) for fav, target in rows]


class FavoriteIn(BaseModel):
    card_number: str


@router.post("/favorites", status_code=201)
async def add_favorite(body: FavoriteIn,
                       user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_session)):
    card = "".join(ch for ch in body.card_number if ch.isdigit())
    target = (await session.execute(
        select(User).where(User.card_number == card)
    )).scalar_one_or_none()
    if target is None:
        raise HTTPException(404, "المستخدم غير موجود")
    if target.id == user.id:
        raise HTTPException(405, "ما تصير تضيف نفسك للمفضلة 😅")
    exists = (await session.execute(
        select(Favorite).where(Favorite.user_id == user.id,
                               Favorite.target_user_id == target.id)
    )).scalar_one_or_none()
    if exists:
        return {"message": "هذا موجود بالمفضلة أصلًا", "favorite": _fav_dict(exists, target)}
    fav = Favorite(user_id=user.id, target_user_id=target.id)
    session.add(fav)
    await session.commit()
    await session.refresh(fav)
    return {"message": "تمت الإضافة للمفضلة ⭐", "favorite": _fav_dict(fav, target)}


@router.delete("/favorites/{target_user_id}")
async def remove_favorite(target_user_id: int,
                          user: User = Depends(get_current_user),
                          session: AsyncSession = Depends(get_session)):
    fav = (await session.execute(
        select(Favorite).where(Favorite.user_id == user.id,
                               Favorite.target_user_id == target_user_id)
    )).scalar_one_or_none()
    if fav is None:
        raise HTTPException(404, "غير موجود بالمفضلة")
    await session.delete(fav)
    await session.commit()
    return {"message": "تمت الإزالة من المفضلة"}
