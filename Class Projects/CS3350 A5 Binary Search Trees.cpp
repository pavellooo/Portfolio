/*
Name: Logan Pavelschak
Date: 11/17/2024
Purpose: write code for binary trees: 
height, size, isComplete and convert BST function implementations
*/

#include <iostream>
using namespace std;

//Include any library that you would like to use here
#include <queue>
#include <vector>

// Data structure to store a binary tree node
struct Node
{
    int key;
    Node* left, * right;

    Node(int key)
    {
        this->key = key;
        this->left = this->right = nullptr;
    }
};


//if you need any helper functions, write them here:

//helper function: store an inorder traversal of all values of the binary tree to a vector, to be sorted later
void storeToVector(Node* root, vector<int>& nodes) {
    if (root == nullptr) {
        return;
    } 
    //in order recursive traversal of the original binary tree, storing each key in the vector
    storeToVector(root->left, nodes);
    nodes.push_back(root->key);
    storeToVector(root->right, nodes);
}

//helper function: using the sorted vector of all values, do an inorder traveral and override all values in order
//note: the vector is sorted so a simple inorder traversal should place all values in the right spot without 
//needing to restructure
void constructBST(Node* root, vector<int>& nodes, int& index) {
    if (root == nullptr) {
        return;
    }
    //inorder traversal of the binary tree, overriding the keys with the values in the sorted vector and incrementing index.
    //this will create a valid binary search tree, where left < root < right
    constructBST(root->left, nodes, index);
    root->key = nodes[index];
    index++;
    constructBST(root->right, nodes, index);
}

//function to print every node's key using inorder traversal (given)
void inorder(Node* root) {
    if (root==nullptr) {
        return;
    }
    else {
        inorder(root->left);
        cout << root->key << " ";
        inorder(root->right);
    }        
}

// function to calculate the height of a binary tree
int height(Node* root)
{
    //if tree is empty, return -1
    if (root == nullptr) {
        return -1;
    }
    //otherwise calculate the height of both subtrees recursively
    int leftHeight = height(root->left);
    int rightHeight = height(root->right);
    //return the greater height + 1
    return 1 + max(leftHeight, rightHeight);
}

//  function to calculate the total number of nodes in a binary tree   
int size(Node* root)
{
    //if the node is empty, return 0 (base case for recursion, and works if tree is empty)
    if (root == nullptr) {
        return 0;
    }
    else { //else recursively add up and return both sides
        return 1 + size(root->left) + size(root->right);
    }
}

//  function to check if a given binary tree is a complete tree or not
//note: the idea is to traverse the tree level-by-level and if a level is not completely filled (and is 
//not the last level), then the tree is incomplete and false is returned. Otherwise, true.
bool isComplete(Node* root)
{
    //base case: empty tree is complete
    if (root == nullptr) {
        return true;
    }
    //initialize a queue to traverse through each level of the tree
    queue<Node*> nodes;
    nodes.push(root);
    //flag variable to indicate if a null node is encountered 
    bool end = false;
    //while loop to traverse through each level in order
    while (!nodes.empty()) {
        Node* current = nodes.front();
        nodes.pop();

        //check left child
        if (current->left) {
            //if a null node was previously encountered, the tree is incomplete
            if (end) {
                return false;
            }
            //enqueue the left child for further processing/traversal
            nodes.push(current->left);
        }
        else { //if child is null, mark the end flag true
            end = true;
        }
        //check right child (same operation/concept as left)
        if (current->right) {
            //if a null node was previously encountered, the tree is incomplete 
            if (end) {
                return false;
            }
            //enqueue right child for further processing/traversal
            nodes.push(current->right);
        }
        else { //if the right child is null, mark the end flag true
            end = true;
        }
    }
    //if the traversal completes without encountering an invalid pattern, then the tree is complete and returns true
    return true;
}


//  function to convert the binary tree to a binary search tree, but maintaining its structure 
void convert_BST(Node* root) {
    //declare vector, and use helper function to put all of the nodes' keys into it
    vector<int> nodes;
    storeToVector(root, nodes);

    //sort the vector's values
    sort(nodes.begin(), nodes.end());
    
    //use helper function to overwrite the binary tree with an inorder traversal and assignment of the sorted values from the vector
    int index = 0;
    constructBST(root, nodes, index);
}


int main()
{
    /* Construct the following tree
              1
            /   \               
           2     3
            \   / \
             5 6   7                      
    */

    Node* root = new Node(1);
    root->left = new Node(2);
    root->right = new Node(3);
    root->left->right = new Node(5);
    root->right->left = new Node(6);
    root->right->right = new Node(7);

    cout << "Printing all nodes with inorder traversal:" << endl;
    inorder(root);
    cout << endl;

    cout << "The size of the tree is " << size(root) <<endl;

    cout << "The height of the tree is " << height(root) << endl;

    if (isComplete(root)) {
        cout << "The tree is a complete binary tree" << endl;
    }
    else {
        cout << "The tree is not a complete binary tree" << endl;
    }

    convert_BST(root);

    cout << "Printing all nodes with inorder traversal after the conversion:" << endl;
    inorder(root);
    cout << endl;

    return 0;
}