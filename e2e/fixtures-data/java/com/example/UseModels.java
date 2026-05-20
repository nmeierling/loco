package com.example;

import com.example.Models;
import com.example.Models.UserModel;
import com.example.Models.OrderModel;

public class UseModels {
    public String describe(UserModel u, OrderModel o) {
        return "user=" + u.name() + " total=" + o.total();
    }
}
