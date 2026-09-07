"""
WealthGenie Open-Weight LLM Platform - Conversation History Manager
Manages multi-turn conversation memory, system prompt persistence, and sliding context window truncation.
"""

from typing import Dict, List
from pydantic import BaseModel, Field
from llm.schema import ChatMessage


class ConversationHistory(BaseModel):
    """Manages state for multi-turn chat interactions."""
    session_id: str = Field(..., description="Unique conversation session ID")
    system_prompt: str = Field(
        "You are WealthGenie AI, a certified financial advisor assistant.",
        description="Active system prompt instructions",
    )
    messages: List[ChatMessage] = Field(default_factory=list, description="History of chat messages")
    max_history_turns: int = Field(10, description="Maximum conversation turns to retain in context")

    def add_message(self, role: str, content: str) -> None:
        """Appends a new turn message to the conversation history."""
        self.messages.append(ChatMessage(role=role, content=content))
        # Maintain sliding window context
        if len(self.messages) > self.max_history_turns * 2:
            # Preserve system turn if any, keep last max_history_turns
            self.messages = self.messages[-(self.max_history_turns * 2):]

    def get_messages_payload(self) -> List[Dict[str, str]]:
        """Returns messages formatted as list of dictionaries."""
        return [{"role": m.role, "content": m.content} for m in self.messages]

    def clear(self) -> None:
        """Clears all conversation history."""
        self.messages.clear()
