export const check = (req, db) => {
  return new Promise((resolve, reject) => {
    if (!req.headers.cookie) resolve({ status: 401, message: 'Unauthorized' })
    const { id, email } = req.cookies
    console.log(id, email)
    if (!id || !email) resolve({ status: 401, message: 'Unauthorized' })
    db.get('SELECT * FROM users WHERE user_id = ? AND email = ?', [id, email], (err, row) => {
      if (err) {
        resolve({
          status: 500,
          message: 'Failed while getting email'
        })
      }
      if (!row) {
        resolve({ status: 401, message: 'Unauthorized' })
      } else {
        resolve({ id, email })
      }
    })
  })
}
