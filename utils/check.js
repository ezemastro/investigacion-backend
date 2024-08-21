export const check = (req, db) => {
  let exist, survey, trivia
  return new Promise((resolve, reject) => {
    if (!req.headers.cookie) return resolve({ exist: false })
    const { id, email } = req.cookies
    if (!id || !email) return resolve({ exist: false })

    db.getConnection((err, connection) => { // **Cambio: Obtención de conexión del pool**
      if (err) {
        return resolve({
          err: true,
          status: 500,
          message: 'Failed while connecting to the database'
        })
      }

      connection.query('SELECT * FROM Users WHERE user_id = ? AND email = ?', [id, email], (err, rows) => {
        if (err) {
          connection.release() // **Cambio: Liberar conexión**
          return resolve({
            err: true,
            status: 500,
            message: 'Failed while getting email'
          })
        }
        if (!rows.length) {
          connection.release() // **Cambio: Liberar conexión**
          return resolve({ exist: false })
        }

        exist = true
        if (!rows[0].bonus_category_id) {
          connection.release() // **Cambio: Liberar conexión**
          return resolve({ email, id, exist, survey, trivia })
        }
        trivia = true

        connection.query('SELECT COUNT(*) AS count FROM Survey_Responses WHERE user_id = ?', [id], (err, rows) => {
          connection.release() // **Cambio: Liberar conexión**
          if (err) return resolve({ err: true, status: 500, message: 'Failed while getting survey' })
          if (rows[0].count > 0) survey = true
          resolve({ email, id, exist, survey, trivia })
        })
      })
    })
  })
}
