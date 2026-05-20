package com.example

import com.example.UserModel
import com.example.OrderModel

fun describeUser(u: UserModel, o: OrderModel): String {
    return "user=${u.name} total=${o.total}"
}
