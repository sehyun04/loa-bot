from discord.ext import commands


async def setup_all_cogs(bot: commands.Bot) -> None:
    from run.cogs.homework import HomeworkCog
    from run.cogs.market import MarketCog
    from run.cogs.merchant import MerchantCog
    from run.cogs.status import StatusCog

    await bot.add_cog(StatusCog(bot))
    await bot.add_cog(MerchantCog(bot))
    await bot.add_cog(HomeworkCog(bot))
    await bot.add_cog(MarketCog(bot))

    # API 키가 없으면 커맨드 자체를 등록하지 않는다. 등록해두고 매번
    # "키가 없어요"를 답하는 것보다 목록에 안 뜨는 편이 덜 헷갈린다.
    from run.core import config

    if config.has_lostark_api():
        from run.cogs.character import CharacterCog
        from run.cogs.hellreward import HellRewardCog

        await bot.add_cog(CharacterCog(bot))
        await bot.add_cog(HellRewardCog(bot))
