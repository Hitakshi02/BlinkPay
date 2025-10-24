import os, time, requests, uuid
from dotenv import load_dotenv
from uagents import Agent, Context
load_dotenv()

SERVER = os.getenv("SERVER_URL", "http://localhost:4000")

agent = Agent(name="billing-agent", seed="billing-agent-seed")

@agent.on_interval(period=60.0)
async def heartbeat(ctx: Context):
    ctx.logger.info("Billing agent alive")

def open_session(user: str, merchant: str, allowance_wei: str, session_id: str):
    r = requests.post(f"{SERVER}/api/session/open", json={
        "sessionId": session_id, "user": user, "merchant": merchant, "allowance": allowance_wei
    })
    r.raise_for_status(); return r.json()

def add_spend(session_id: str, delta_wei: str):
    r = requests.post(f"{SERVER}/api/session/spend", json={"sessionId": session_id, "delta": delta_wei})
    r.raise_for_status(); return r.json()

def settle(session_id: str):
    r = requests.post(f"{SERVER}/api/session/settle", json={"sessionId": session_id})
    r.raise_for_status(); return r.json()

if __name__ == "__main__":
    # Demo run (replace addresses)
    session_id = uuid.uuid4().hex
    user = "0xUser..."       # fill during demo
    merchant = "0xMerchant..."  # or from server env
    allowance = str(10 * 10**18)  # 10 PYUSD in wei

    print("Opening session...")
    try:
        print(open_session(user, merchant, allowance, session_id))
        print("Spending 0.05 PYUSD...")
        print(add_spend(session_id, str(5 * 10**16)))
        time.sleep(1)
        print("Settle...")
        print(settle(session_id))
    except Exception as e:
        print("Error:", e)

    agent.run()
