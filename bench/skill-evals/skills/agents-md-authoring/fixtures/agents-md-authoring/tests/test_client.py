from tidewatch import client


def test_base_url():
    assert client.BASE.startswith("https://")
