from discord.ext import commands


async def setup_all_cogs(bot: commands.Bot) -> None:
    from run.cogs.gemnave import GemnaveCog
    from run.cogs.homework import HomeworkCog
    from run.cogs.market import MarketCog
    from run.cogs.merchant import MerchantCog

    await bot.add_cog(MerchantCog(bot))
    await bot.add_cog(HomeworkCog(bot))
    await bot.add_cog(MarketCog(bot))
    # 링크 한 장이라 API 키도 외부 호출도 없다. 조건 없이 붙인다.
    await bot.add_cog(GemnaveCog(bot))

    # 자연어 질문은 키가 있을 때만 붙인다. 없으면 멘션에 반응하지 않는다.
    from run.services import llm_router

    if llm_router.available():
        from run.cogs.ask import AskCog

        await bot.add_cog(AskCog(bot))

    # API 키가 없으면 커맨드 자체를 등록하지 않는다. 등록해두고 매번
    # "키가 없어요"를 답하는 것보다 목록에 안 뜨는 편이 덜 헷갈린다.
    from run.core import config

    if config.has_lostark_api():
        from run.cogs.character import CharacterCog
        from run.cogs.gauntlet import GauntletCog
        from run.cogs.hellreward import HellRewardCog
        from run.cogs.refine import RefineCog
        from run.cogs.specup import SpecUpCog

        await bot.add_cog(CharacterCog(bot))
        await bot.add_cog(HellRewardCog(bot))
        await bot.add_cog(SpecUpCog(bot))
        await bot.add_cog(GauntletCog(bot))
        # 재련은 재료 시세로 골드를 뽑아서 키가 없으면 반쪽짜리가 된다.
        await bot.add_cog(RefineCog(bot))
