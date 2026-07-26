from dataclasses import dataclass

# 거래소 판매 시 떼이는 수수료
MARKET_FEE = 0.05


@dataclass(frozen=True)
class BidResult:
    bid: int
    party_size: int
    share_per_member: int
    winner_cost: int


def calculate(bid: int, party_size: int) -> BidResult:
    """경매 낙찰 시 실제 부담액.

    낙찰금은 파티 전원에게 균등 분배되고 낙찰자도 자기 몫을 받는다.
    그래서 실부담은 낙찰가 전액이 아니라 (인원-1)/인원 만큼이다.
    """
    share = bid // party_size
    return BidResult(
        bid=bid,
        party_size=party_size,
        share_per_member=share,
        winner_cost=bid - share,
    )


def break_even_bid(market_price: int, party_size: int) -> int:
    """거래소에 파는 것과 손익이 같아지는 최대 입찰가.

    거래소는 수수료를 떼므로 실수령이 시세보다 적고, 경매는 실부담이
    낙찰가보다 적다. 두 값이 같아지는 지점이 더 써도 되는 한계선이다.
    """
    net_sale = market_price * (1 - MARKET_FEE)
    return int(net_sale * party_size / (party_size - 1))
