const express = require("express")
const authController = require("../controllers/auth.controller")

const router = express.Router()


/*POST /api/auth/register */
router.post("/register", authController.userRegisterContrller)


/*POST /api/auth/login */
router.post("/login", authController.userLoginController)


module.exports = router;