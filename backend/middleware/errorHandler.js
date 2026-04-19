module.exports = () => {
  return (err, req, res, next) => {
    console.error('[Express] 未处理错误', err);
    res.status(500).json({ error: err?.message || 'internal_error' });
  };
};