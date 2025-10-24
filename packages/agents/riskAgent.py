import os, time, requests
from dotenv import load_dotenv
from uagents import Agent, Context
load_dotenv()

SERVER = os.getenv("SERVER_URL", "http://localhost:4000")
MAX_PER_MINUTE = int(os.getenv("RISK_MAX_PER_MINUTE_WEI", "50000000000000000"))

agent = Agent(name="risk-agent", seed="risk-agent-seed")

@agent.on_interval(period=30.0)
async def scan(ctx: Context):
    # naive polling; in real build, subscribe to events / server push
    ctx.logger.info("Risk agent scanning (stub)")

if __name__ == "__main__":
    agent.run()
