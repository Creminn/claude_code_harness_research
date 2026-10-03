# Compatibility shim that claude-harness mounts into the Graphiti container (PYTHONPATH).
#
# graphiti-core 0.30.1 calls anthropic AsyncMessages.create(..., temperature=...), but the
# anthropic SDK 1.x shipped in zepai/knowledge-graph-mcp:1.1.0 no longer accepts that
# argument, so every extraction fails with "unexpected keyword argument 'temperature'".
# This drops the argument only when the installed SDK does not accept it, so it becomes a
# no-op once Graphiti fixes the call upstream.
try:
    import functools
    import inspect

    from anthropic.resources.messages import AsyncMessages

    if 'temperature' not in inspect.signature(AsyncMessages.create).parameters:
        _original_create = AsyncMessages.create

        @functools.wraps(_original_create)
        async def _create_without_temperature(self, *args, **kwargs):
            kwargs.pop('temperature', None)
            return await _original_create(self, *args, **kwargs)

        AsyncMessages.create = _create_without_temperature
except Exception:  # never break the server over a compatibility shim
    pass
