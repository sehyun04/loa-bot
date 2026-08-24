import unittest

from run.services import llm_router


class GemmaResponseTest(unittest.TestCase):
    def test_structured_tool_call(self) -> None:
        reply = llm_router._normalise_gemma_message(
            {
                "content": (
                    '{"tool_calls":[{"name":"calculate_auction",'
                    '"arguments":{"bid":300000,"party_size":8}}]}'
                )
            }
        )

        self.assertEqual(len(reply.content), 1)
        self.assertEqual(reply.content[0].type, "tool_use")
        self.assertEqual(reply.content[0].name, "calculate_auction")
        self.assertEqual(reply.content[0].input, {"bid": 300000, "party_size": 8})

    def test_native_openai_tool_call(self) -> None:
        reply = llm_router._normalise_gemma_message(
            {
                "content": None,
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {
                            "name": "get_character_spec",
                            "arguments": '{"name":"김세현"}',
                        },
                    }
                ],
            }
        )

        self.assertEqual(reply.content[0].name, "get_character_spec")
        self.assertEqual(reply.content[0].input, {"name": "김세현"})

    def test_text_reply(self) -> None:
        reply = llm_router._normalise_gemma_message(
            {"content": '{"text":"재련 성공 확률을 알려주세요."}'}
        )

        self.assertEqual(reply.content[0].type, "text")
        self.assertEqual(reply.content[0].text, "재련 성공 확률을 알려주세요.")

    def test_markdown_fence_is_tolerated(self) -> None:
        reply = llm_router._normalise_gemma_message(
            {"content": '```json\n{"tool_calls":[{"name":"list_card_alerts","arguments":{}}]}\n```'}
        )

        self.assertEqual(reply.content[0].name, "list_card_alerts")

    def test_invalid_json_is_rejected(self) -> None:
        with self.assertRaises(llm_router.APIStatusError):
            llm_router._normalise_gemma_message({"content": "알겠습니다."})


if __name__ == "__main__":
    unittest.main()
