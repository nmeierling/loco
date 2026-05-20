package com.example;

public class Models {
    public record UserModel(int id, String name) {}
    public record OrderModel(int id, double total) {}
}
